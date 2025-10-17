// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AgreementData {
  user_id: string;
  organization_id: string;
  location_id: string;
  signature_base64: string;
  number_of_bots: number;
  services_per_month: number;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const data: AgreementData = await req.json();
    const { 
      user_id,
      organization_id,
      location_id,
      signature_base64,
      number_of_bots,
      services_per_month,
    } = data;

    console.log('📄 Creating rental agreement for user:', user_id);

    // Calculate pricing based on business rules (server-side, secure)
    const BOT_RENTAL_FEE_PER_BOT = 150; // R150 per bot per month
    const SERVICE_FEE_PER_VISIT = 150;  // R150 per service visit
    const DEPOSIT_PER_BOT = 500;        // R500 deposit per bot
    const BILLING_DAY = 1;              // Bill on 1st of each month

    const monthly_rental_fee = number_of_bots * BOT_RENTAL_FEE_PER_BOT;
    const service_fee_per_visit = SERVICE_FEE_PER_VISIT;
    const service_total = service_fee_per_visit * services_per_month;
    const deposit_total = number_of_bots * DEPOSIT_PER_BOT;
    const monthly_total = monthly_rental_fee + service_total;

    console.log('💰 Calculated pricing:', {
      number_of_bots,
      services_per_month,
      monthly_rental_fee,
      service_total,
      deposit_total,
      monthly_total
    });

    // Step 1: Fetch user profile data from database
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('first_name, surname, id_number, cell_phone, physical_address, physical_city, physical_province, physical_postal_code, email')
      .eq('id', user_id)
      .single();

    if (profileError || !profile) {
      console.error('Error fetching user profile:', profileError);
      throw new Error('User profile not found or incomplete');
    }

    // Step 2: Fetch auth user data for email
    const { data: { user: authUser }, error: authError } = await supabase.auth.admin.getUserById(user_id);
    
    if (authError || !authUser) {
      console.error('Error fetching auth user:', authError);
      throw new Error('User authentication data not found');
    }

    // Step 3: Fetch location data (must match organization)
    console.log('📍 Fetching location:', location_id, 'for organization:', organization_id);
    
    const { data: location, error: locationError } = await supabase
      .from('locations')
      .select('id, name, address, suburb, city, province, postal_code, organization_id')
      .eq('id', location_id)
      .eq('organization_id', organization_id)
      .single();

    if (locationError || !location) {
      console.error('Error fetching location:', locationError);
      console.error('Location ID:', location_id);
      console.error('Organization ID:', organization_id);
      throw new Error(`Location not found or does not belong to this organization. Location ID: ${location_id}`);
    }

    console.log('✅ Using location:', location.name);

    console.log('✅ Fetched all required data from database');

    // Step 4: Create rental agreement record
    const agreementNumber = `RA-${new Date().getFullYear()}-${Date.now()}`;
    
    const { data: newAgreement, error: createError } = await supabase
      .from('rental_agreements')
      .insert({
        agreement_number: agreementNumber,
        user_id: user_id,
        organization_id: organization_id,
        location_id: location.id,
        bot_type: 'mow_bot',
        number_of_bots: number_of_bots,
        services_per_month: services_per_month,
        monthly_total: monthly_total,
        bot_rental_total: monthly_rental_fee,
        service_total: service_total,
        setup_fee: deposit_total,
        signer_first_name: profile.first_name || 'Unknown',
        signer_surname: profile.surname || 'Unknown',
        signer_id_number: profile.id_number || '',
        signer_address: [
          profile.physical_address,
          profile.physical_city,
          profile.physical_province,
          profile.physical_postal_code
        ].filter(Boolean).join(', '),
        signer_city: profile.physical_city || '',
        signer_province: profile.physical_province || '',
        signer_phone: profile.cell_phone || authUser.phone || '',
        signer_email: authUser.email || '',
        billing_day: BILLING_DAY,
        status: 'draft',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError || !newAgreement) {
      console.error('Error creating rental agreement:', createError);
      throw createError || new Error('Failed to create rental agreement');
    }

    const rental_agreement_id = newAgreement.id;
    console.log('✅ Rental agreement created:', rental_agreement_id);

    // Step 5: Upload signature image to storage
    const signatureFileName = `${user_id}/${rental_agreement_id}_signature.png`;
    const signatureBuffer = Uint8Array.from(
      atob(signature_base64.replace(/^data:image\/\w+;base64,/, '')),
      (c) => c.charCodeAt(0)
    );

    const { error: signatureUploadError } = await supabase.storage
      .from('signatures')
      .upload(signatureFileName, signatureBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (signatureUploadError) {
      console.error('Error uploading signature:', signatureUploadError);
      throw signatureUploadError;
    }

    // Get public URL for signature (for PDF generation)
    const { data: signatureUrlData } = supabase.storage
      .from('signatures')
      .getPublicUrl(signatureFileName);

    const signatureUrl = signatureUrlData.publicUrl;
    console.log('✅ Signature uploaded:', signatureFileName);

    // Step 6: Generate PDF HTML (we'll use a template)
    const agreementHtml = generateAgreementHTML({
      number_of_bots,
      services_per_month,
      monthly_rental_fee,
      service_fee_per_visit,
      service_total,
      deposit_total,
      monthly_total,
      billing_day: BILLING_DAY,
      profile,
      location,
      signatureUrl,
      agreement_date: new Date().toISOString().split('T')[0],
      agreement_number: agreementNumber,
    });

    // Step 7: Convert HTML to PDF
    console.log('📄 Generating PDF from HTML...');
    const pdfContent = await generatePDFFromHTML(agreementHtml);

    // Step 8: Upload PDF to storage
    const pdfFileName = `${user_id}/${rental_agreement_id}_agreement.pdf`;
    
    const { error: pdfUploadError } = await supabase.storage
      .from('agreements')
      .upload(pdfFileName, pdfContent, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (pdfUploadError) {
      console.error('Error uploading PDF:', pdfUploadError);
      throw pdfUploadError;
    }

    console.log('✅ PDF uploaded:', pdfFileName);

    // Step 9: Update rental agreement with URLs and mark as signed
    const { error: updateError } = await supabase
      .from('rental_agreements')
      .update({
        signature_image_url: signatureUrl,
        agreement_pdf_url: `${supabaseUrl}/storage/v1/object/agreements/${pdfFileName}`,
        signed_at: new Date().toISOString(),
        status: 'active',
      })
      .eq('id', rental_agreement_id);

    if (updateError) {
      console.error('Error updating rental agreement:', updateError);
      throw updateError;
    }

    console.log('✅ Rental agreement updated with URLs and activated');

    // Step 10: Generate signed URLs for secure download
    const { data: signedSignatureUrl } = await supabase.storage
      .from('signatures')
      .createSignedUrl(signatureFileName, 3600); // 1 hour expiry

    const { data: signedPdfUrl } = await supabase.storage
      .from('agreements')
      .createSignedUrl(pdfFileName, 3600);

    return new Response(
      JSON.stringify({
        success: true,
        rental_agreement_id,
        signature_url: signedSignatureUrl?.signedUrl || signatureUrl,
        pdf_url: signedPdfUrl?.signedUrl || `${supabaseUrl}/storage/v1/object/agreements/${pdfFileName}`,
        signature_path: signatureFileName,
        pdf_path: pdfFileName,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('Error in generate-agreement-pdf:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'An unexpected error occurred',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});

function generateAgreementHTML(data: any): string {
  const {
    number_of_bots,
    services_per_month,
    monthly_rental_fee,
    service_fee_per_visit,
    service_total,
    deposit_total,
    monthly_total,
    billing_day,
    profile,
    location,
    signatureUrl,
    agreement_date,
    agreement_number,
  } = data;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>BotKorp Rental Agreement</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #2563eb;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      color: #2563eb;
      font-size: 28px;
      margin-bottom: 10px;
    }
    .header .subtitle {
      color: #64748b;
      font-size: 14px;
    }
    .agreement-info {
      background: #f8fafc;
      border-left: 4px solid #2563eb;
      padding: 15px;
      margin-bottom: 25px;
    }
    .agreement-info p {
      margin: 5px 0;
      font-size: 14px;
    }
    .section {
      margin-bottom: 30px;
    }
    .section h2 {
      color: #1e40af;
      font-size: 20px;
      margin-bottom: 15px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e2e8f0;
    }
    .section h3 {
      color: #3b82f6;
      font-size: 16px;
      margin: 15px 0 10px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 10px 20px;
      margin-bottom: 15px;
    }
    .info-label {
      font-weight: 600;
      color: #475569;
    }
    .info-value {
      color: #1e293b;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e2e8f0;
    }
    th {
      background: #f1f5f9;
      font-weight: 600;
      color: #1e40af;
    }
    .highlight {
      background: #dbeafe;
      border-left: 4px solid #3b82f6;
      padding: 15px;
      margin: 20px 0;
      font-size: 14px;
      color: #1e40af;
    }
    .terms {
      background: #f8fafc;
      padding: 20px;
      border-radius: 8px;
      font-size: 14px;
    }
    .terms ol {
      padding-left: 20px;
    }
    .terms li {
      margin-bottom: 10px;
    }
    .signature-section {
      margin-top: 40px;
      padding: 20px;
      border: 2px solid #e2e8f0;
      border-radius: 8px;
    }
    .signature-box {
      margin-top: 20px;
      padding: 20px;
      background: #f8fafc;
      border-radius: 8px;
    }
    .signature-image {
      max-width: 300px;
      margin: 15px 0;
      border: 1px solid #e2e8f0;
      padding: 10px;
      background: white;
    }
    @media print {
      body { padding: 20px; }
      .pagebreak { page-break-before: always; }
    }
  </style>
</head>
<body>

  <div class="header">
    <h1>BOTKORP RENTAL AGREEMENT</h1>
    <div class="subtitle">Autonomous Lawn Mower Bot Rental Service</div>
  </div>

  <div class="agreement-info">
    <p><strong>Agreement Number:</strong> ${agreement_number}</p>
    <p><strong>Agreement Date:</strong> ${new Date(agreement_date).toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    <p><strong>Service Type:</strong> Monthly Bot Rental with Service Visits</p>
  </div>

  <div class="section">
    <h2>1. PARTIES TO THE AGREEMENT</h2>
    
    <h3>1.1 The Lessor (Service Provider)</h3>
    <div class="info-grid">
      <div class="info-label">Company Name:</div>
      <div class="info-value">BotKorp (Pty) Ltd</div>
      <div class="info-label">Parent Company:</div>
      <div class="info-value">A member of Exolution Technologies (Pty) Ltd</div>
      <div class="info-label">Registration:</div>
      <div class="info-value">2024/567890/07</div>
      <div class="info-label">VAT Number:</div>
      <div class="info-value">4123456789</div>
      <div class="info-label">Address:</div>
      <div class="info-value">MAP HOUSE, Umbilo, Durban, 4061</div>
    </div>

    <h3>1.2 The Lessee (Customer)</h3>
    <div class="info-grid">
      <div class="info-label">Full Name:</div>
      <div class="info-value">${profile.first_name || ''} ${profile.surname || ''}</div>
      <div class="info-label">ID Number:</div>
      <div class="info-value">${profile.id_number || 'Not provided'}</div>
      <div class="info-label">Phone:</div>
      <div class="info-value">${profile.cell_phone || 'Not provided'}</div>
      <div class="info-label">Address:</div>
      <div class="info-value">${profile.physical_address || ''}<br>
      ${profile.physical_city || ''}, ${profile.physical_province || ''}, ${profile.physical_postal_code || ''}</div>
    </div>

    <h3>1.3 Service Location</h3>
    <div class="info-grid">
      <div class="info-label">Location Name:</div>
      <div class="info-value">${location.name}</div>
      <div class="info-label">Address:</div>
      <div class="info-value">${location.address || ''}<br>${location.city}, ${location.province}</div>
    </div>
  </div>

  <div class="section">
    <h2>2. RENTAL TERMS & PRICING</h2>
    
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Details</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Number of Bots</td>
          <td>${number_of_bots} autonomous lawn mower bot(s)</td>
          <td>-</td>
        </tr>
        <tr>
          <td>Monthly Rental Fee</td>
          <td>R150.00 per bot per month</td>
          <td><strong>R${monthly_rental_fee.toFixed(2)}</strong></td>
        </tr>
        <tr>
          <td>Service Visits</td>
          <td>${services_per_month}x per month (edge trimming + battery swap)</td>
          <td><strong>R${service_total.toFixed(2)}</strong></td>
        </tr>
        <tr>
          <td><strong>Total Monthly Fee</strong></td>
          <td>Recurring monthly charge</td>
          <td><strong>R${monthly_total.toFixed(2)}</strong></td>
        </tr>
        <tr>
          <td>Refundable Deposit</td>
          <td>R500.00 per bot (returned when bots are returned)</td>
          <td><strong>R${deposit_total.toFixed(2)}</strong></td>
        </tr>
        <tr>
          <td>Billing Day</td>
          <td>Monthly billing on the ${billing_day}${getOrdinalSuffix(billing_day)} of each month</td>
          <td>-</td>
        </tr>
        <tr>
          <td>Start Date</td>
          <td>Agreement starts on ${new Date(agreement_date).toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
          <td>-</td>
        </tr>
      </tbody>
    </table>

    <div class="highlight">
      ✓ No Long-term Contract | ✓ Cancel Anytime (30 days notice) | ✓ Pause for Winter | ✓ Flexible Changes
    </div>
  </div>

  <div class="section">
    <h2>3. TERMS AND CONDITIONS</h2>
    <div class="terms">
      ${getDefaultTerms()}
    </div>
  </div>

  <div class="signature-section">
    <h2>4. SIGNATURE</h2>
    
    <p>By signing below, the Lessee acknowledges that they have read, understood, and agree to all terms and conditions of this Rental Agreement.</p>

    <div class="signature-box">
      <p><strong>Customer Signature:</strong></p>
      <img src="${signatureUrl}" alt="Signature" class="signature-image" />
      <p><strong>Date:</strong> ${agreement_date}</p>
      <p><strong>Name:</strong> ${profile.first_name || ''} ${profile.surname || ''}</p>
    </div>

    <p style="margin-top: 40px;"><strong>For BotKorp (Pty) Ltd:</strong></p>
    <p>This agreement is electronically signed and validated through the BotKorp system.</p>
  </div>

</body>
</html>
`;
}

function getOrdinalSuffix(day: number): string {
  if (day > 3 && day < 21) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function getDefaultTerms(): string {
  return `
<ol>
  <li><strong>Rental Period:</strong> This is a month-to-month rental agreement with no long-term commitment. Either party may terminate with 30 days written notice.</li>
  <li><strong>Equipment:</strong> BotKorp provides autonomous lawn mower bots in good working condition. The bots remain the property of BotKorp at all times.</li>
  <li><strong>Service Visits:</strong> BotKorp will visit the service location according to the agreed schedule to perform edge trimming, battery swaps, and general maintenance.</li>
  <li><strong>Customer Responsibilities:</strong> Customer must ensure the lawn is clear of obstacles, the boundary wire is intact, and provide safe access to the property.</li>
  <li><strong>Payment Terms:</strong> Monthly fees are due on the ${getOrdinalSuffix(1)} of each month. A refundable deposit is collected upfront and returned upon termination when bots are returned in good condition.</li>
  <li><strong>Cancellation:</strong> Customer may cancel with 30 days written notice. Deposit will be refunded after bots are returned and inspected.</li>
  <li><strong>Winter Pause:</strong> Customer may pause service during winter months (May-August) without penalty. Monthly fees are suspended during pause periods.</li>
  <li><strong>Equipment Damage:</strong> Customer is responsible for damage caused by negligence or misuse. Normal wear and tear is covered by BotKorp.</li>
  <li><strong>Liability:</strong> BotKorp maintains comprehensive insurance. Customer should ensure their property insurance is adequate.</li>
  <li><strong>Service Guarantee:</strong> If bots malfunction due to equipment failure, BotKorp will repair or replace at no cost to the customer.</li>
  <li><strong>Modifications:</strong> Any changes to this agreement must be made in writing and signed by both parties.</li>
  <li><strong>Governing Law:</strong> This agreement is governed by the laws of South Africa.</li>
  <li><strong>Electronic Signature:</strong> The parties agree that electronic signatures are legally binding and equivalent to handwritten signatures.</li>
</ol>
`;
}

async function generatePDFFromHTML(html: string): Promise<Uint8Array> {
  // Use PDFShift API to convert HTML to PDF
  const pdfShiftApiKey = Deno.env.get('PDFSHIFT_API_KEY');
  
  if (!pdfShiftApiKey) {
    console.warn('⚠️  PDFSHIFT_API_KEY not set - Cannot generate PDF');
    console.warn('📄 To fix: Set PDFSHIFT_API_KEY secret in Supabase');
    console.warn('   npx supabase secrets set PDFSHIFT_API_KEY=your_key_here');
    throw new Error('PDF generation service not configured. Please contact support.');
  }
  
  try {
    console.log('🔄 Converting HTML to PDF using PDFShift...');
    
    const response = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(pdfShiftApiKey + ':')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: html,
        landscape: false,
        use_print: false,
        margin: {
          top: '20mm',
          bottom: '20mm',
          left: '15mm',
          right: '15mm'
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('PDFShift error:', errorText);
      throw new Error(`PDF generation failed: ${response.status} - ${errorText}`);
    }

    const pdfBuffer = await response.arrayBuffer();
    console.log('✅ PDF generated successfully:', pdfBuffer.byteLength, 'bytes');
    
    return new Uint8Array(pdfBuffer);
  } catch (error: any) {
    console.error('PDF generation error:', error);
    throw new Error(`Failed to generate PDF: ${error.message}`);
  }
}
