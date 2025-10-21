"""
Invoice PDF Template
"""

INVOICE_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Invoice {{ invoice.invoice_number }}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Arial', sans-serif;
      line-height: 1.6;
      color: #333;
      padding: 40px 30px;
    }
    .invoice-header {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 3px solid #2563eb;
    }
    .company-info h1 {
      color: #2563eb;
      font-size: 32px;
      margin-bottom: 10px;
    }
    .company-info p {
      color: #64748b;
      font-size: 14px;
      margin: 3px 0;
    }
    .invoice-meta {
      text-align: right;
    }
    .invoice-meta h2 {
      color: #1e40af;
      font-size: 24px;
      margin-bottom: 15px;
    }
    .invoice-meta p {
      font-size: 14px;
      margin: 5px 0;
    }
    .invoice-meta .status {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      margin-top: 10px;
    }
    .status-paid { background: #dcfce7; color: #166534; }
    .status-sent { background: #dbeafe; color: #1e40af; }
    .status-overdue { background: #fee2e2; color: #991b1b; }
    .status-draft { background: #f3f4f6; color: #374151; }
    
    .billing-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
      margin-bottom: 40px;
    }
    .billing-box {
      background: #f8fafc;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #2563eb;
    }
    .billing-box h3 {
      color: #1e40af;
      font-size: 16px;
      margin-bottom: 12px;
    }
    .billing-box p {
      font-size: 14px;
      margin: 3px 0;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 30px 0;
    }
    thead {
      background: #1e40af;
      color: white;
    }
    th {
      padding: 12px;
      text-align: left;
      font-weight: 600;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #e2e8f0;
    }
    tr:hover {
      background: #f8fafc;
    }
    .line-item-desc {
      color: #64748b;
      font-size: 13px;
    }
    .text-right {
      text-align: right;
    }
    
    .totals-section {
      margin-left: auto;
      width: 350px;
      background: #f8fafc;
      padding: 20px;
      border-radius: 8px;
    }
    .totals-row {
      display: grid;
      grid-template-columns: 1fr auto;
      padding: 10px 0;
      border-bottom: 1px solid #e2e8f0;
    }
    .totals-row.total {
      font-size: 18px;
      font-weight: 700;
      color: #1e40af;
      border-top: 2px solid #2563eb;
      border-bottom: none;
      padding-top: 15px;
      margin-top: 10px;
    }
    
    .payment-info {
      background: #dbeafe;
      border-left: 4px solid #2563eb;
      padding: 20px;
      margin: 30px 0;
      border-radius: 8px;
    }
    .payment-info h3 {
      color: #1e40af;
      margin-bottom: 10px;
    }
    .payment-info p {
      font-size: 14px;
      margin: 5px 0;
    }
    
    .footer {
      margin-top: 50px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      color: #64748b;
      font-size: 12px;
    }
    .footer p {
      margin: 3px 0;
    }
    
    @media print {
      body { padding: 20px; }
      .pagebreak { page-break-before: always; }
    }
  </style>
</head>
<body>

  <div class="invoice-header">
    <div class="company-info">
      <h1>{{ invoice.vendor_name or 'BotKorp (Pty) Ltd' }}</h1>
      <p>{{ invoice.vendor_parent_company or 'A member of Exolution Technologies (Pty) Ltd' }}</p>
      <p style="margin-top: 10px;">{{ invoice.vendor_address_line1 or 'MAP HOUSE' }}, {{ invoice.vendor_address_line2 or 'Umbilo' }}</p>
      <p>{{ invoice.vendor_city or 'Durban' }}, {{ invoice.vendor_postal_code or '4061' }}</p>
      <p>{{ invoice.vendor_province or 'KwaZulu-Natal' }}, {{ invoice.vendor_country or 'South Africa' }}</p>
      <p style="margin-top: 10px;">VAT: {{ invoice.vendor_vat_number or '4123456789' }}</p>
      <p>Reg: {{ invoice.vendor_registration_number or '2024/567890/07' }}</p>
    </div>
    
    <div class="invoice-meta">
      <h2>INVOICE</h2>
      <p><strong>Invoice #:</strong> {{ invoice.invoice_number }}</p>
      <p><strong>Issue Date:</strong> {{ invoice.issue_date }}</p>
      <p><strong>Due Date:</strong> {{ invoice.due_date }}</p>
      <span class="status status-{{ invoice.status }}">{{ invoice.status }}</span>
    </div>
  </div>

  <div class="billing-section">
    <div class="billing-box">
      <h3>Bill To:</h3>
      <p><strong>{{ invoice.billing_name }}</strong></p>
      <p>{{ invoice.billing_address }}</p>
      <p>{{ invoice.billing_city }}, {{ invoice.billing_province }}</p>
      <p>{{ invoice.billing_postal_code }}</p>
      <p>{{ invoice.billing_email }}</p>
    </div>
    
    <div class="billing-box">
      <h3>Service Period:</h3>
      <p><strong>From:</strong> {{ invoice.period_start }}</p>
      <p><strong>To:</strong> {{ invoice.period_end }}</p>
      {% if invoice.rental_agreement %}
      <p style="margin-top: 10px;"><strong>Agreement:</strong> {{ invoice.rental_agreement.agreement_number }}</p>
      {% endif %}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 50%;">Description</th>
        <th class="text-right" style="width: 15%;">Quantity</th>
        <th class="text-right" style="width: 15%;">Unit Price</th>
        <th class="text-right" style="width: 20%;">Total</th>
      </tr>
    </thead>
    <tbody>
      {% if invoice.line_items %}
        {% for item in invoice.line_items %}
        <tr>
          <td>
            <strong>{{ item.description }}</strong>
            {% if item.details %}
            <div class="line-item-desc">{{ item.details }}</div>
            {% endif %}
          </td>
          <td class="text-right">{{ item.quantity }}</td>
          <td class="text-right">R{{ "%.2f"|format(item.unit_price) }}</td>
          <td class="text-right"><strong>R{{ "%.2f"|format(item.total) }}</strong></td>
        </tr>
        {% endfor %}
      {% else %}
        <tr>
          <td>Bot Rental Fee</td>
          <td class="text-right">{{ invoice.rental_agreement.number_of_bots if invoice.rental_agreement else 1 }}</td>
          <td class="text-right">R150.00</td>
          <td class="text-right"><strong>R{{ "%.2f"|format(invoice.bot_rental_total) }}</strong></td>
        </tr>
        <tr>
          <td>
            <strong>Service Visits</strong>
            <div class="line-item-desc">Edge trimming, battery swap, maintenance</div>
          </td>
          <td class="text-right">{{ invoice.rental_agreement.services_per_month if invoice.rental_agreement else 4 }}</td>
          <td class="text-right">R150.00</td>
          <td class="text-right"><strong>R{{ "%.2f"|format(invoice.service_visits_total) }}</strong></td>
        </tr>
      {% endif %}
    </tbody>
  </table>

  <div class="totals-section">
    <div class="totals-row">
      <span>Subtotal:</span>
      <span>R{{ "%.2f"|format(invoice.subtotal) }}</span>
    </div>
    {% if invoice.tax_amount > 0 %}
    <div class="totals-row">
      <span>VAT ({{ invoice.tax_rate }}%):</span>
      <span>R{{ "%.2f"|format(invoice.tax_amount) }}</span>
    </div>
    {% endif %}
    <div class="totals-row total">
      <span>Total Due:</span>
      <span>R{{ "%.2f"|format(invoice.amount_due) }}</span>
    </div>
    {% if invoice.amount_paid > 0 %}
    <div class="totals-row">
      <span>Amount Paid:</span>
      <span style="color: #16a34a;">-R{{ "%.2f"|format(invoice.amount_paid) }}</span>
    </div>
    <div class="totals-row total">
      <span>Balance Due:</span>
      <span>R{{ "%.2f"|format(invoice.amount_due - invoice.amount_paid) }}</span>
    </div>
    {% endif %}
  </div>

  <div class="payment-info">
    <h3>Payment Information</h3>
    <p><strong>Pay online:</strong> https://botkorp.co.za/portal/billing</p>
    <p><strong>Payment Methods:</strong> Credit Card, Debit Card, EFT</p>
    {% if invoice.notes %}
    <p style="margin-top: 10px;">{{ invoice.notes }}</p>
    {% endif %}
  </div>

  <div class="footer">
    <p><strong>{{ invoice.vendor_name or 'BotKorp (Pty) Ltd' }}</strong></p>
    <p>{{ invoice.vendor_phone or '+27 31 123 4567' }} | {{ invoice.vendor_email or 'billing@botkorp.co.za' }} | {{ invoice.vendor_website or 'www.botkorp.co.za' }}</p>
    <p style="margin-top: 10px;">Thank you for your business!</p>
  </div>

</body>
</html>
"""

