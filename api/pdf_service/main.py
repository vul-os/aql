"""
BotKorp PDF Service API
Generates PDFs for agreements and invoices, and sends them via email
"""

import os
import io
import base64
from datetime import datetime
from flask import Flask, request, jsonify
from weasyprint import HTML, CSS
from jinja2 import Template
from supabase import create_client, Client
import resend

app = Flask(__name__)

# Configuration
SUPABASE_URL = os.environ.get('SUPABASE_URL')
SUPABASE_SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
RESEND_API_KEY = os.environ.get('RESEND_API_KEY')

# Initialize clients
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
resend.api_key = RESEND_API_KEY


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'pdf_service',
        'version': '1.0.0'
    })


@app.route('/api/generate-agreement-pdf', methods=['POST'])
def generate_agreement_pdf():
    """
    Generate a rental agreement PDF
    
    Expected JSON body:
    {
        "user_id": "uuid",
        "organization_id": "uuid",
        "location_id": "uuid",
        "signature_base64": "data:image/png;base64,...",
        "number_of_bots": 2,
        "services_per_month": 4
    }
    """
    try:
        data = request.get_json()
        
        # Extract request data
        user_id = data['user_id']
        organization_id = data['organization_id']
        location_id = data['location_id']
        signature_base64 = data['signature_base64']
        number_of_bots = data['number_of_bots']
        services_per_month = data['services_per_month']
        
        print(f"📄 Generating agreement for user: {user_id}")
        
        # Calculate pricing (server-side)
        pricing = calculate_pricing(number_of_bots, services_per_month)
        
        # Fetch required data from database
        legal_profile = fetch_org_legal_profile(organization_id)
        auth_user = fetch_auth_user(user_id)
        location = fetch_location(location_id, organization_id)
        
        # Create rental agreement record
        agreement_number = f"RA-{datetime.now().year}-{int(datetime.now().timestamp())}"
        
        rental_agreement = create_rental_agreement(
            agreement_number=agreement_number,
            user_id=user_id,
            organization_id=organization_id,
            location_id=location_id,
            pricing=pricing,
            legal_profile=legal_profile,
            auth_user=auth_user
        )
        
        rental_agreement_id = rental_agreement['id']
        
        # Upload signature
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
            agreement_date=datetime.now().strftime('%Y-%m-%d')
        )
        
        # Generate PDF
        pdf_bytes = generate_pdf_from_html(agreement_html)
        
        # Upload PDF
        pdf_path = upload_pdf(
            user_id=user_id,
            rental_agreement_id=rental_agreement_id,
            pdf_bytes=pdf_bytes,
            filename_suffix='agreement'
        )
        
        # Update rental agreement with URLs
        update_rental_agreement(
            rental_agreement_id=rental_agreement_id,
            signature_path=signature_path,
            pdf_path=pdf_path
        )
        
        print(f"✅ Agreement generated: {rental_agreement_id}")
        
        return jsonify({
            'success': True,
            'rental_agreement_id': rental_agreement_id,
            'signature_url': f"{SUPABASE_URL}/storage/v1/object/public/signatures/{signature_path}",
            'pdf_url': f"{SUPABASE_URL}/storage/v1/object/public/agreements/{pdf_path}",
            'signature_path': signature_path,
            'pdf_path': pdf_path
        })
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


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
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


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
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ==================== Helper Functions ====================

def calculate_pricing(number_of_bots, services_per_month):
    """Calculate pricing based on business rules"""
    BOT_RENTAL_FEE = 150
    SERVICE_FEE = 150
    DEPOSIT_PER_BOT = 500
    
    monthly_rental = number_of_bots * BOT_RENTAL_FEE
    service_total = services_per_month * SERVICE_FEE
    monthly_total = monthly_rental + service_total
    deposit_total = number_of_bots * DEPOSIT_PER_BOT
    
    return {
        'number_of_bots': number_of_bots,
        'services_per_month': services_per_month,
        'monthly_rental_fee': monthly_rental,
        'service_fee_per_visit': SERVICE_FEE,
        'service_total': service_total,
        'monthly_total': monthly_total,
        'deposit_total': deposit_total,
        'billing_day': 1
    }


def fetch_user_profile(user_id):
    """Fetch user profile from database"""
    response = supabase.table('profiles').select('*').eq('id', user_id).single().execute()
    if not response.data:
        raise Exception('User profile not found')
    return response.data


def fetch_org_legal_profile(organization_id):
    """Fetch organization legal profile from database"""
    response = supabase.table('organization_legal_profiles').select('*').eq('organization_id', organization_id).single().execute()
    if not response.data:
        raise Exception(f'Organization legal profile not found for organization: {organization_id}')
    return response.data


def fetch_auth_user(user_id):
    """Fetch auth user data"""
    response = supabase.auth.admin.get_user_by_id(user_id)
    if not response.user:
        raise Exception('Auth user not found')
    return response.user


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


def create_rental_agreement(agreement_number, user_id, organization_id, location_id, pricing, legal_profile, auth_user):
    """Create rental agreement record"""
    agreement_data = {
        'agreement_number': agreement_number,
        'user_id': user_id,
        'organization_id': organization_id,
        'location_id': location_id,
        'bot_type': 'mow_bot',
        'number_of_bots': pricing['number_of_bots'],
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


def render_agreement_template(agreement_number, pricing, legal_profile, location, signature_url, agreement_date):
    """Render agreement HTML template"""
    # Import the template
    from templates.agreement import AGREEMENT_TEMPLATE
    
    template = Template(AGREEMENT_TEMPLATE)
    
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
    """Send invoice via email using Resend"""
    params = {
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
    
    result = resend.Emails.send(params)
    return result


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)), debug=True)

