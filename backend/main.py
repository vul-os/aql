"""
BotKorp Backend API - Cloud Run Function
Generates PDFs for agreements and invoices, and sends them via email
"""

import os
import io
import base64
import requests
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from weasyprint import HTML, CSS
from jinja2 import Template
from supabase import create_client, Client

# Import configuration
from config import (
    SUPABASE_URL, 
    SUPABASE_SERVICE_KEY, 
    RESEND_API_KEY,
    BILLING_DAY,
    DEBUG
)

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend requests

# Initialize Supabase client
try:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    print(f"✅ Supabase client initialized: {SUPABASE_URL}")
except Exception as e:
    print(f"⚠️  Warning: Supabase client initialization failed: {str(e)}")
    supabase = None


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    supabase_status = 'connected' if supabase else 'disconnected'
    
    return jsonify({
        'status': 'healthy',
        'service': 'botkorp_backend',
        'version': '1.0.0',
        'timestamp': datetime.now().isoformat(),
        'supabase': supabase_status,
        'environment': os.environ.get('ENVIRONMENT', 'unknown')
    })


@app.route('/api/pricing', methods=['GET'])
def get_pricing():
    """
    Get pricing structure from database
    
    Query params:
    - bot_type: mow_bot (default), pool_bot, security_bot, weather_station
    """
    try:
        bot_type = request.args.get('bot_type', 'mow_bot')
        
        pricing_data = fetch_pricing_from_db(bot_type)
        
        return jsonify({
            'success': True,
            'pricing': pricing_data
        })
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/calculate-pricing', methods=['POST'])
def calculate_pricing_endpoint():
    """
    Calculate pricing for a specific configuration
    
    Expected JSON body:
    {
        "number_of_bots": 2,
        "services_per_month": 4,
        "bot_type": "mow_bot"
    }
    """
    try:
        data = request.get_json()
        number_of_bots = data.get('number_of_bots', 1)
        services_per_month = data.get('services_per_month', 4)
        bot_type = data.get('bot_type', 'mow_bot')
        
        pricing = calculate_pricing(number_of_bots, services_per_month, bot_type)
        
        return jsonify({
            'success': True,
            'pricing': pricing
        })
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/create-rental-agreements', methods=['POST'])
def create_rental_agreements():
    """
    Create rental agreements for service setup
    
    Creates one rental agreement per garden/bot, including:
    - Database records (rental_agreements table)
    - Signature image uploads
    - PDF generation and upload
    - Bot assignment linking
    
    Expected JSON body:
    {
        "user_id": "uuid",
        "organization_id": "uuid",
        "location_id": "uuid",
        "signature_base64": "data:image/png;base64,...",
        "service_id": "uuid",  // REQUIRED
        "gardens": [           // REQUIRED: Array of gardens
            {
                "id": "uuid",
                "name": "Front Lawn",
                "area_sqm": 250
            }
        ],
        "services_per_month": 4,
        "billing_day": 1  // optional, defaults to 1st of month
    }
    
    Returns:
    {
        "success": true,
        "agreements": [
            {
                "rental_agreement_id": "uuid",
                "garden_id": "uuid",
                "garden_name": "Front Lawn",
                "pdf_url": "...",
                "signature_url": "..."
            }
        ]
    }
    """
    try:
        data = request.get_json()
        
        # Extract request data
        user_id = data['user_id']
        organization_id = data['organization_id']
        location_id = data['location_id']
        service_id = data.get('service_id')  # NEW: Service ID
        signature_base64 = data['signature_base64']
        gardens = data.get('gardens', [])
        services_per_month = data['services_per_month']
        billing_day = data.get('billing_day', BILLING_DAY)
        
        if not gardens:
            raise ValueError("At least one garden is required")
        
        if not service_id:
            raise ValueError("service_id is required")
        
        print(f"📄 Generating {len(gardens)} agreement(s) for user: {user_id}, service: {service_id}")
        
        # Fetch common data once
        legal_profile = fetch_org_legal_profile(organization_id)
        auth_user = fetch_auth_user(user_id)
        location = fetch_location(location_id, organization_id)
        
        agreements = []
        
        # Create ONE agreement PER garden/bot
        for index, garden in enumerate(gardens):
            garden_id = garden.get('id')
            garden_name = garden.get('name', f'Garden {index + 1}')
            garden_area = garden.get('area_sqm', 0)
            
            print(f"  Creating agreement {index + 1}/{len(gardens)} for garden: {garden_name}")
            
            # Calculate pricing for 1 bot
            pricing = calculate_pricing(1, services_per_month, billing_day=billing_day)
            pricing['garden_name'] = garden_name
            pricing['garden_area'] = garden_area
            
            # Create unique agreement number
            timestamp = int(datetime.now().timestamp() * 1000) + index  # Add index to make unique
            agreement_number = f"RA-{datetime.now().year}-{timestamp}"
            
            # Create rental agreement record
            rental_agreement = create_rental_agreement(
                agreement_number=agreement_number,
                user_id=user_id,
                organization_id=organization_id,
                location_id=location_id,
                service_id=service_id,
                garden_id=garden_id,
                pricing=pricing,
                legal_profile=legal_profile,
                auth_user=auth_user
            )
            
            rental_agreement_id = rental_agreement['id']
            
            # Upload signature (same signature for all agreements)
            signature_path = upload_signature(
                user_id=user_id,
                rental_agreement_id=rental_agreement_id,
                signature_base64=signature_base64
            )
            
            # Generate Agreement HTML
            agreement_html = render_agreement_template(
                agreement_number=agreement_number,
                pricing=pricing,
                legal_profile=legal_profile,
                location=location,
                signature_url=f"{SUPABASE_URL}/storage/v1/object/public/signatures/{signature_path}",
                agreement_date=datetime.now().strftime('%Y-%m-%d'),
                garden_name=garden_name
            )
            
            # Generate PDF
            pdf_bytes = generate_pdf_from_html(agreement_html)
            
            # Upload PDF
            pdf_path = upload_pdf(
                user_id=user_id,
                rental_agreement_id=rental_agreement_id,
                pdf_bytes=pdf_bytes,
                filename_suffix=f'agreement_{garden_id[:8]}'
            )
            
            # Update rental agreement with URLs
            update_rental_agreement(
                rental_agreement_id=rental_agreement_id,
                signature_path=signature_path,
                pdf_path=pdf_path
            )
            
            print(f"  ✅ Agreement created: {rental_agreement_id} for {garden_name}")
            
            agreements.append({
                'rental_agreement_id': rental_agreement_id,
                'garden_id': garden_id,
                'garden_name': garden_name,
                'signature_url': f"{SUPABASE_URL}/storage/v1/object/public/signatures/{signature_path}",
                'pdf_url': f"{SUPABASE_URL}/storage/v1/object/public/agreements/{pdf_path}",
            })
        
        print(f"✅ All {len(agreements)} agreement(s) generated successfully")
        
        return jsonify({
            'success': True,
            'agreements': agreements,
            'total_agreements': len(agreements)
        })
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# Backward compatibility endpoint (deprecated)
@app.route('/api/generate-agreement-pdf', methods=['POST'])
def generate_agreement_pdf_deprecated():
    """
    DEPRECATED: Use /api/create-rental-agreements instead
    
    This endpoint is maintained for backward compatibility only.
    """
    print("⚠️  Warning: Using deprecated endpoint /api/generate-agreement-pdf")
    print("   Please update to /api/create-rental-agreements")
    return create_rental_agreements()


@app.route('/api/generate-invoice-pdf', methods=['POST'])
def generate_invoice_pdf():
    """
    Generate an invoice PDF
    
    Expected JSON body:
    {
        "invoice_id": "uuid"
    }
    """
    try:
        data = request.get_json()
        invoice_id = data['invoice_id']
        
        print(f"📄 Generating invoice PDF: {invoice_id}")
        
        # Fetch invoice data
        invoice = fetch_invoice(invoice_id)
        
        # Generate Invoice HTML
        invoice_html = render_invoice_template(invoice)
        
        # Generate PDF
        pdf_bytes = generate_pdf_from_html(invoice_html)
        
        # Upload PDF
        pdf_path = upload_invoice_pdf(
            invoice_id=invoice_id,
            user_id=invoice['user_id'],
            pdf_bytes=pdf_bytes
        )
        
        # Update invoice with PDF URL
        update_invoice_pdf(invoice_id, pdf_path)
        
        print(f"✅ Invoice PDF generated: {invoice_id}")
        
        return jsonify({
            'success': True,
            'invoice_id': invoice_id,
            'pdf_url': f"{SUPABASE_URL}/storage/v1/object/public/invoices/{pdf_path}",
            'pdf_path': pdf_path
        })
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/create-service-amendment', methods=['POST'])
def create_service_amendment():
    """
    Create a service amendment request (pending admin approval)
    
    Expected JSON body:
    {
        "user_id": "uuid",
        "service_id": "uuid",
        "amendment_type": "add_gardens" or "remove_gardens",
        "current_count": 2,
        "new_count": 4,
        "signature_base64": "data:image/png;base64,..."
    }
    """
    try:
        data = request.get_json()
        
        user_id = data['user_id']
        service_id = data['service_id']
        amendment_type = data['amendment_type']
        current_count = data['current_count']
        new_count = data['new_count']
        signature_base64 = data['signature_base64']
        
        print(f"📝 Creating amendment request: {amendment_type} for service {service_id}")
        print(f"   Change: {current_count} → {new_count}")
        
        # Create amendment record in database
        amendment_data = {
            'service_id': service_id,
            'user_id': user_id,
            'amendment_type': amendment_type,
            'current_garden_count': current_count,
            'new_garden_count': new_count,
            'status': 'pending_approval',
            'created_at': datetime.now().isoformat()
        }
        
        response = supabase.table('service_amendments').insert(amendment_data).execute()
        amendment = response.data[0]
        amendment_id = amendment['id']
        
        # Upload signature for the amendment
        signature_data = signature_base64.split(',')[1] if ',' in signature_base64 else signature_base64
        signature_bytes = base64.b64decode(signature_data)
        signature_path = f"amendments/{user_id}/{amendment_id}_signature.png"
        
        supabase.storage.from_('signatures').upload(
            signature_path,
            signature_bytes,
            {'content-type': 'image/png', 'upsert': 'true'}
        )
        
        # Update amendment with signature URL
        signature_url = f"{SUPABASE_URL}/storage/v1/object/public/signatures/{signature_path}"
        supabase.table('service_amendments').update({
            'signature_url': signature_url,
            'signature_ip_address': request.headers.get('X-Forwarded-For', request.remote_addr),
            'signature_user_agent': request.headers.get('User-Agent'),
            'signed_at': datetime.now().isoformat()
        }).eq('id', amendment_id).execute()
        
        print(f"✅ Amendment request created: {amendment_id}")
        
        return jsonify({
            'success': True,
            'amendment_id': amendment_id,
            'signature_url': signature_url,
            'status': 'pending_approval',
            'message': 'Amendment request submitted successfully. Admin approval required.'
        })
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# Installation notification moved to Supabase Edge Function
# See: supabase/functions/send-installation-notification/

@app.route('/api/send-invoice-email', methods=['POST'])
def send_invoice_email():
    """
    Generate invoice PDF and send via email
    
    Expected JSON body:
    {
        "invoice_id": "uuid"
    }
    """
    try:
        data = request.get_json()
        invoice_id = data['invoice_id']
        
        print(f"📧 Sending invoice email: {invoice_id}")
        
        # Fetch invoice data
        invoice = fetch_invoice(invoice_id)
        
        # Generate PDF
        invoice_html = render_invoice_template(invoice)
        pdf_bytes = generate_pdf_from_html(invoice_html)
        
        # Upload PDF
        pdf_path = upload_invoice_pdf(
            invoice_id=invoice_id,
            user_id=invoice['user_id'],
            pdf_bytes=pdf_bytes
        )
        
        # Update invoice with PDF URL
        update_invoice_pdf(invoice_id, pdf_path)
        
        # Send email with PDF attachment
        email_result = send_invoice_via_email(invoice, pdf_bytes)
        
        print(f"✅ Invoice emailed: {invoice_id}")
        
        return jsonify({
            'success': True,
            'invoice_id': invoice_id,
            'pdf_url': f"{SUPABASE_URL}/storage/v1/object/public/invoices/{pdf_path}",
            'email_sent': True,
            'email_id': email_result.get('id')
        })
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ==================== Helper Functions ====================

def fetch_pricing_from_db(bot_type='mow_bot'):
    """Fetch pricing from database using new flexible pricing structure"""
    # Call the Supabase RPC function which handles the new pricing_plans structure
    response = supabase.rpc('get_full_pricing', {
        'p_bot_type': bot_type,
        'p_organization_id': None
    }).execute()
    
    if not response.data:
        raise Exception(f'No pricing found for bot type {bot_type}. Please configure pricing in the database.')
    
    return response.data


def calculate_pricing(number_of_bots, services_per_month, bot_type='mow_bot', billing_day=None):
    """Calculate pricing using new flexible pricing structure"""
    # Call the Supabase RPC function for consistent pricing calculation
    response = supabase.rpc('get_tier_pricing', {
        'p_bot_type': bot_type,
        'p_number_of_bots': number_of_bots,
        'p_services_per_month': services_per_month
    }).execute()
    
    if not response.data:
        raise Exception(f'Unable to calculate pricing for bot type {bot_type}')
    
    pricing = response.data
    
    # Use provided billing_day or default to BILLING_DAY constant
    if billing_day is None:
        billing_day = BILLING_DAY
    
    # Return in expected format (backward compatible)
    return {
        'number_of_bots': number_of_bots,
        'services_per_month': services_per_month,
        'bot_rental_monthly': float(pricing.get('bot_rental_per_bot', 0)),
        'service_price_per_visit': float(pricing.get('service_price_per_visit', 0)),
        'monthly_rental_fee': float(pricing.get('bot_rental_total', 0)),
        'service_fee_per_visit': float(pricing.get('service_price_per_visit', 0)),
        'service_total': float(pricing.get('service_total', 0)),
        'monthly_total': float(pricing.get('monthly_total', 0)),
        'setup_fee': float(pricing.get('setup_fee', 0)) / number_of_bots if number_of_bots > 0 else 0,
        'deposit_total': float(pricing.get('setup_fee', 0)),
        'billing_day': billing_day,
        'tier_name': pricing.get('tier_name', 'Standard'),
        'pricing_type': pricing.get('pricing_type', 'calculated')
    }


def fetch_user_profile(user_id):
    """Fetch user profile from database"""
    response = supabase.table('profiles').select('*').eq('id', user_id).single().execute()
    if not response.data:
        raise Exception('User profile not found')
    return response.data


def fetch_auth_user(user_id):
    """Fetch auth user data"""
    response = supabase.auth.admin.get_user_by_id(user_id)
    if not response.user:
        raise Exception('Auth user not found')
    return response.user


def fetch_org_legal_profile(organization_id):
    """Fetch organization legal profile from database"""
    response = supabase.table('organization_legal_profiles').select('*').eq('organization_id', organization_id).single().execute()
    if not response.data:
        raise Exception(f'Organization legal profile not found for organization: {organization_id}')
    return response.data


def fetch_location(location_id, organization_id):
    """Fetch location from database"""
    response = supabase.table('locations').select('*').eq('id', location_id).eq('organization_id', organization_id).single().execute()
    if not response.data:
        raise Exception(f'Location not found: {location_id}')
    return response.data


def fetch_invoice(invoice_id):
    """Fetch invoice with all related data"""
    response = supabase.table('invoices').select('''
        *,
        user:profiles(*),
        organization:organizations(*),
        rental_agreement:rental_agreements(*)
    ''').eq('id', invoice_id).single().execute()
    
    if not response.data:
        raise Exception(f'Invoice not found: {invoice_id}')
    return response.data


def create_rental_agreement(agreement_number, user_id, organization_id, location_id, pricing, legal_profile, auth_user, service_id=None, garden_id=None):
    """Create rental agreement record - one per garden/bot"""
    agreement_data = {
        'agreement_number': agreement_number,
        'user_id': user_id,
        'organization_id': organization_id,
        'location_id': location_id,
        'service_id': service_id,  # NEW: Link to service
        'garden_id': garden_id,    # NEW: Link to specific garden
        'bot_type': 'mow_bot',
        'number_of_bots': 1,  # CHANGED: Always 1 bot per agreement
        'services_per_month': pricing['services_per_month'],
        'monthly_total': float(pricing['monthly_total']),
        'bot_rental_total': float(pricing['monthly_rental_fee']),
        'service_total': float(pricing['service_total']),
        'setup_fee': float(pricing['deposit_total']),
        'signer_first_name': legal_profile.get('first_name', 'Unknown'),
        'signer_surname': legal_profile.get('surname', 'Unknown'),
        'signer_id_number': legal_profile.get('id_number', ''),
        'signer_address': ', '.join(filter(None, [
            legal_profile.get('physical_address'),
            legal_profile.get('physical_city'),
            legal_profile.get('physical_province'),
            legal_profile.get('physical_postal_code')
        ])),
        'signer_city': legal_profile.get('physical_city', ''),
        'signer_province': legal_profile.get('physical_province', ''),
        'signer_phone': legal_profile.get('cell_phone', ''),
        'signer_email': auth_user.email,
        'billing_day': pricing['billing_day'],
        'status': 'draft',
        'started_at': datetime.now().isoformat()
    }
    
    response = supabase.table('rental_agreements').insert(agreement_data).execute()
    return response.data[0]


def upload_signature(user_id, rental_agreement_id, signature_base64):
    """Upload signature image to Supabase Storage"""
    # Remove data URL prefix
    signature_data = signature_base64.split(',')[1] if ',' in signature_base64 else signature_base64
    signature_bytes = base64.b64decode(signature_data)
    
    file_path = f"{user_id}/{rental_agreement_id}_signature.png"
    
    supabase.storage.from_('signatures').upload(
        file_path,
        signature_bytes,
        {'content-type': 'image/png', 'upsert': 'true'}
    )
    
    return file_path


def upload_pdf(user_id, rental_agreement_id, pdf_bytes, filename_suffix='agreement'):
    """Upload PDF to Supabase Storage"""
    file_path = f"{user_id}/{rental_agreement_id}_{filename_suffix}.pdf"
    
    supabase.storage.from_('agreements').upload(
        file_path,
        pdf_bytes,
        {'content-type': 'application/pdf', 'upsert': 'true'}
    )
    
    return file_path


def upload_invoice_pdf(invoice_id, user_id, pdf_bytes):
    """Upload invoice PDF to Supabase Storage"""
    file_path = f"{user_id}/{invoice_id}.pdf"
    
    supabase.storage.from_('invoices').upload(
        file_path,
        pdf_bytes,
        {'content-type': 'application/pdf', 'upsert': 'true'}
    )
    
    return file_path


def update_rental_agreement(rental_agreement_id, signature_path, pdf_path):
    """Update rental agreement with file URLs"""
    supabase.table('rental_agreements').update({
        'signature_image_url': f"{SUPABASE_URL}/storage/v1/object/public/signatures/{signature_path}",
        'agreement_pdf_url': f"{SUPABASE_URL}/storage/v1/object/public/agreements/{pdf_path}",
        'signed_at': datetime.now().isoformat(),
        'status': 'active'
    }).eq('id', rental_agreement_id).execute()


def update_invoice_pdf(invoice_id, pdf_path):
    """Update invoice with PDF URL"""
    supabase.table('invoices').update({
        'invoice_pdf_url': f"{SUPABASE_URL}/storage/v1/object/public/invoices/{pdf_path}",
        'status': 'sent',
        'updated_at': datetime.now().isoformat()
    }).eq('id', invoice_id).execute()


def generate_pdf_from_html(html_content):
    """Convert HTML to PDF using WeasyPrint"""
    pdf_file = HTML(string=html_content).write_pdf()
    return pdf_file


def render_agreement_template(agreement_number, pricing, legal_profile, location, signature_url, agreement_date, garden_name=None):
    """Render agreement HTML template"""
    # Import the template
    from templates.agreement import AGREEMENT_TEMPLATE
    
    template = Template(AGREEMENT_TEMPLATE)
    
    # Add garden info to pricing context
    if garden_name:
        pricing['garden_name'] = garden_name
    
    return template.render(
        agreement_number=agreement_number,
        agreement_date=agreement_date,
        legal_profile=legal_profile,
        location=location,
        pricing=pricing,
        signature_url=signature_url
    )


def render_invoice_template(invoice):
    """Render invoice HTML template"""
    # Import the template
    from templates.invoice import INVOICE_TEMPLATE
    
    template = Template(INVOICE_TEMPLATE)
    
    return template.render(invoice=invoice)


def send_invoice_via_email(invoice, pdf_bytes):
    """Send invoice via email using Resend REST API"""
    url = "https://api.resend.com/emails"
    headers = {
        "Authorization": f"Bearer {RESEND_API_KEY}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "from": "BotKorp Billing <billing@botkorp.co.za>",
        "to": [invoice['billing_email']],
        "subject": f"Invoice {invoice['invoice_number']} - R{invoice['total_amount']}",
        "html": f"""
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <h2 style="color: #2563eb;">Invoice from BotKorp</h2>
            <p>Dear {invoice['billing_name']},</p>
            <p>Your invoice for the period {invoice['period_start']} to {invoice['period_end']} is attached.</p>
            <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p><strong>Invoice Number:</strong> {invoice['invoice_number']}</p>
                <p><strong>Total Amount:</strong> R{invoice['total_amount']}</p>
                <p><strong>Due Date:</strong> {invoice['due_date']}</p>
            </div>
            <p>You can view and pay your invoice online at: <a href="https://botkorp.co.za/portal/billing">https://botkorp.co.za/portal/billing</a></p>
            <p>Best regards,<br>The BotKorp Team</p>
        </body>
        </html>
        """,
        "attachments": [
            {
                "filename": f"{invoice['invoice_number']}.pdf",
                "content": base64.b64encode(pdf_bytes).decode()
            }
        ]
    }
    
    response = requests.post(url, json=payload, headers=headers)
    response.raise_for_status()
    return response.json()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=DEBUG)

