"""
Agreement PDF Template
"""

AGREEMENT_TEMPLATE = """
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
      padding: 40px 30px;
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
      page-break-inside: avoid;
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
      page-break-inside: avoid;
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
    <p><strong>Agreement Number:</strong> {{ agreement_number }}</p>
    <p><strong>Agreement Date:</strong> {{ agreement_date }}</p>
    <p><strong>Service Type:</strong> Monthly Bot Rental with Service Package</p>
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
      <div class="info-value">{{ legal_profile.first_name }} {{ legal_profile.surname }}</div>
      <div class="info-label">ID Number:</div>
      <div class="info-value">{{ legal_profile.id_number or 'Not provided' }}</div>
      <div class="info-label">Phone:</div>
      <div class="info-value">{{ legal_profile.cell_phone or 'Not provided' }}</div>
      <div class="info-label">Address:</div>
      <div class="info-value">{{ legal_profile.physical_address or '' }}<br>
      {{ legal_profile.physical_city or '' }}, {{ legal_profile.physical_province or '' }}, {{ legal_profile.physical_postal_code or '' }}</div>
    </div>

    <h3>1.3 Service Location</h3>
    <div class="info-grid">
      <div class="info-label">Location Name:</div>
      <div class="info-value">{{ location.name }}</div>
      <div class="info-label">Address:</div>
      <div class="info-value">{{ location.address or '' }}<br>{{ location.city }}, {{ location.province }}</div>
      {% if pricing.garden_name %}
      <div class="info-label">Garden/Area:</div>
      <div class="info-value">{{ pricing.garden_name }}{% if pricing.total_gardens_at_location > 1 %} ({{ pricing.garden_number }} of {{ pricing.total_gardens_at_location }} gardens at this location){% endif %}</div>
      <div class="info-label">Area Size:</div>
      <div class="info-value">{{ pricing.garden_area }} m²</div>
      {% endif %}
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
          <td>{{ pricing.number_of_bots }} autonomous lawn mower bot(s)</td>
          <td>-</td>
        </tr>
        <tr>
          <td>Monthly Bot Rental</td>
          <td>R150.00 per bot per month</td>
          <td><strong>R{{ "%.2f"|format(pricing.monthly_rental_fee) }}</strong></td>
        </tr>
        <tr>
          <td>Monthly Service Fee</td>
          <td>{% if pricing.service_total > 0 %}Includes edge trimming, battery swaps, and bot servicing{% if pricing.total_gardens_at_location > 1 %} (covers all {{ pricing.total_gardens_at_location }} gardens at this location){% endif %}{% else %}Service fee applied to first garden only - R0.00 for this garden{% endif %}</td>
          <td><strong>R{{ "%.2f"|format(pricing.service_total) }}</strong></td>
        </tr>
        <tr>
          <td><strong>Total Monthly Fee</strong></td>
          <td>Recurring monthly charge</td>
          <td><strong>R{{ "%.2f"|format(pricing.monthly_total) }}</strong></td>
        </tr>
        <tr>
          <td>Setup Fee</td>
          <td>R299.00 per bot (one-time, non-refundable)</td>
          <td><strong>R{{ "%.2f"|format(pricing.deposit_total) }}</strong></td>
        </tr>
        <tr>
          <td>Billing Day</td>
          <td>Monthly billing on the 1st of each month</td>
          <td>-</td>
        </tr>
        <tr>
          <td>Start Date</td>
          <td>Agreement starts on {{ agreement_date }}</td>
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
      <ol>
        <li><strong>Rental Period:</strong> Month-to-month rental with no long-term commitment. Either party may terminate with 30 days written notice.</li>
        <li><strong>Equipment:</strong> BotKorp provides autonomous lawn mower bots in good working condition. Bots remain BotKorp property.</li>
        <li><strong>Service:</strong> Monthly service fee includes all edge trimming, battery swaps, and bot maintenance according to agreed schedule.</li>
        <li><strong>Customer Responsibilities:</strong> Keep lawn clear of obstacles, maintain boundary wire, provide safe property access.</li>
        <li><strong>Payment Terms:</strong> Monthly fees due on 1st of each month. Setup fee charged on first invoice.</li>
        <li><strong>Cancellation:</strong> Cancel with 30 days written notice. No refund on setup fee.</li>
        <li><strong>Winter Pause:</strong> Pause service during winter (May-August) without penalty. Monthly fees suspended.</li>
        <li><strong>Equipment Damage:</strong> Customer responsible for negligence or misuse. Normal wear covered by BotKorp.</li>
        <li><strong>Liability:</strong> BotKorp maintains comprehensive insurance. Customer should ensure adequate property insurance.</li>
        <li><strong>Service Guarantee:</strong> Bot malfunctions due to equipment failure repaired/replaced at no cost.</li>
        <li><strong>Modifications:</strong> Agreement changes must be in writing and signed by both parties.</li>
        <li><strong>Governing Law:</strong> Governed by laws of South Africa.</li>
        <li><strong>Electronic Signature:</strong> Electronic signatures legally binding and equivalent to handwritten.</li>
      </ol>
    </div>
  </div>

  <div class="signature-section">
    <h2>4. SIGNATURE</h2>
    
    <p>By signing below, the Lessee acknowledges reading, understanding, and agreeing to all terms and conditions.</p>

    <div class="signature-box">
      <p><strong>Customer Signature:</strong></p>
      <img src="{{ signature_url }}" alt="Signature" class="signature-image" />
      <p><strong>Date:</strong> {{ agreement_date }}</p>
      <p><strong>Name:</strong> {{ legal_profile.first_name }} {{ legal_profile.surname }}</p>
    </div>

    <p style="margin-top: 40px;"><strong>For BotKorp (Pty) Ltd:</strong></p>
    <p>This agreement is electronically signed and validated through the BotKorp system.</p>
  </div>

</body>
</html>
"""

