// ISO 3166-1 alpha-2 countries, bundled.
//
// # Why this is not an API call
//
// It used to be. `api.countries()` fetched GET /reference/countries, a route
// the hub has never served, and Signup caught the 404 and fell back to a list
// of exactly one country. So the country selector offered "South Africa" and
// nothing else, to everyone, everywhere — and country_code is not decoration:
// the hub validates it and stores it on the account.
//
// A country list is identical on every hub in the world. Asking a self-hosted
// box to serve one would be a round trip, a failure mode and a route to
// maintain, in exchange for data that cannot vary. It belongs in the bundle.
//
// # Why flags are computed rather than stored
//
// A flag emoji is the country's two letters as Unicode REGIONAL INDICATOR
// SYMBOLS. Deriving it means a code and its flag cannot disagree — the whole
// class of "ZA showing the wrong flag" stops existing, and the table below
// stays half the size and readable.

export type CountryRef = {
  code: string;
  name: string;
  flag: string;
};

/**
 * Turn "ZA" into 🇿🇦.
 *
 * Regional indicators run from U+1F1E6 (A) to U+1F1FF (Z), so each ASCII
 * letter maps by a fixed offset. Anything that is not two ASCII letters gets
 * an empty string rather than a mojibake pair: a selector with no flag reads
 * as plain, while a broken one reads as a bug in the product.
 */
export function flagFor(code: string): string {
  const up = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(up)) return '';
  return String.fromCodePoint(...[...up].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65)));
}

// code:name pairs, comma-separated. A compact string rather than 249 object
// literals: this is a table, it is read as a table, and a diff that touches one
// country should be one line.
const TABLE =
  'AF:Afghanistan,AX:Åland Islands,AL:Albania,DZ:Algeria,AS:American Samoa,AD:Andorra,AO:Angola,' +
  'AI:Anguilla,AQ:Antarctica,AG:Antigua and Barbuda,AR:Argentina,AM:Armenia,AW:Aruba,AU:Australia,' +
  'AT:Austria,AZ:Azerbaijan,BS:Bahamas,BH:Bahrain,BD:Bangladesh,BB:Barbados,BY:Belarus,BE:Belgium,' +
  'BZ:Belize,BJ:Benin,BM:Bermuda,BT:Bhutan,BO:Bolivia,BQ:Bonaire Sint Eustatius and Saba,' +
  'BA:Bosnia and Herzegovina,BW:Botswana,BV:Bouvet Island,BR:Brazil,IO:British Indian Ocean Territory,' +
  'BN:Brunei Darussalam,BG:Bulgaria,BF:Burkina Faso,BI:Burundi,CV:Cabo Verde,KH:Cambodia,CM:Cameroon,' +
  'CA:Canada,KY:Cayman Islands,CF:Central African Republic,TD:Chad,CL:Chile,CN:China,' +
  'CX:Christmas Island,CC:Cocos (Keeling) Islands,CO:Colombia,KM:Comoros,CG:Congo,' +
  'CD:Congo (Democratic Republic),CK:Cook Islands,CR:Costa Rica,CI:Côte d’Ivoire,HR:Croatia,CU:Cuba,' +
  'CW:Curaçao,CY:Cyprus,CZ:Czechia,DK:Denmark,DJ:Djibouti,DM:Dominica,DO:Dominican Republic,' +
  'EC:Ecuador,EG:Egypt,SV:El Salvador,GQ:Equatorial Guinea,ER:Eritrea,EE:Estonia,SZ:Eswatini,' +
  'ET:Ethiopia,FK:Falkland Islands,FO:Faroe Islands,FJ:Fiji,FI:Finland,FR:France,GF:French Guiana,' +
  'PF:French Polynesia,TF:French Southern Territories,GA:Gabon,GM:Gambia,GE:Georgia,DE:Germany,' +
  'GH:Ghana,GI:Gibraltar,GR:Greece,GL:Greenland,GD:Grenada,GP:Guadeloupe,GU:Guam,GT:Guatemala,' +
  'GG:Guernsey,GN:Guinea,GW:Guinea-Bissau,GY:Guyana,HT:Haiti,HM:Heard Island and McDonald Islands,' +
  'VA:Holy See,HN:Honduras,HK:Hong Kong,HU:Hungary,IS:Iceland,IN:India,ID:Indonesia,IR:Iran,IQ:Iraq,' +
  'IE:Ireland,IM:Isle of Man,IL:Israel,IT:Italy,JM:Jamaica,JP:Japan,JE:Jersey,JO:Jordan,' +
  'KZ:Kazakhstan,KE:Kenya,KI:Kiribati,KP:Korea (North),KR:Korea (South),KW:Kuwait,KG:Kyrgyzstan,' +
  'LA:Laos,LV:Latvia,LB:Lebanon,LS:Lesotho,LR:Liberia,LY:Libya,LI:Liechtenstein,LT:Lithuania,' +
  'LU:Luxembourg,MO:Macao,MG:Madagascar,MW:Malawi,MY:Malaysia,MV:Maldives,ML:Mali,MT:Malta,' +
  'MH:Marshall Islands,MQ:Martinique,MR:Mauritania,MU:Mauritius,YT:Mayotte,MX:Mexico,' +
  'FM:Micronesia,MD:Moldova,MC:Monaco,MN:Mongolia,ME:Montenegro,MS:Montserrat,MA:Morocco,' +
  'MZ:Mozambique,MM:Myanmar,NA:Namibia,NR:Nauru,NP:Nepal,NL:Netherlands,NC:New Caledonia,' +
  'NZ:New Zealand,NI:Nicaragua,NE:Niger,NG:Nigeria,NU:Niue,NF:Norfolk Island,' +
  'MK:North Macedonia,MP:Northern Mariana Islands,NO:Norway,OM:Oman,PK:Pakistan,PW:Palau,' +
  'PS:Palestine,PA:Panama,PG:Papua New Guinea,PY:Paraguay,PE:Peru,PH:Philippines,PN:Pitcairn,' +
  'PL:Poland,PT:Portugal,PR:Puerto Rico,QA:Qatar,RE:Réunion,RO:Romania,RU:Russia,RW:Rwanda,' +
  'BL:Saint Barthélemy,SH:Saint Helena,KN:Saint Kitts and Nevis,LC:Saint Lucia,MF:Saint Martin,' +
  'PM:Saint Pierre and Miquelon,VC:Saint Vincent and the Grenadines,WS:Samoa,SM:San Marino,' +
  'ST:Sao Tome and Principe,SA:Saudi Arabia,SN:Senegal,RS:Serbia,SC:Seychelles,SL:Sierra Leone,' +
  'SG:Singapore,SX:Sint Maarten,SK:Slovakia,SI:Slovenia,SB:Solomon Islands,SO:Somalia,' +
  'ZA:South Africa,GS:South Georgia and the South Sandwich Islands,SS:South Sudan,ES:Spain,' +
  'LK:Sri Lanka,SD:Sudan,SR:Suriname,SJ:Svalbard and Jan Mayen,SE:Sweden,CH:Switzerland,' +
  'SY:Syria,TW:Taiwan,TJ:Tajikistan,TZ:Tanzania,TH:Thailand,TL:Timor-Leste,TG:Togo,TK:Tokelau,' +
  'TO:Tonga,TT:Trinidad and Tobago,TN:Tunisia,TR:Türkiye,TM:Turkmenistan,TC:Turks and Caicos Islands,' +
  'TV:Tuvalu,UG:Uganda,UA:Ukraine,AE:United Arab Emirates,GB:United Kingdom,US:United States,' +
  'UM:United States Minor Outlying Islands,UY:Uruguay,UZ:Uzbekistan,VU:Vanuatu,VE:Venezuela,' +
  'VN:Viet Nam,VG:Virgin Islands (British),VI:Virgin Islands (U.S.),WF:Wallis and Futuna,' +
  'EH:Western Sahara,YE:Yemen,ZM:Zambia,ZW:Zimbabwe';

/**
 * Every country, sorted by name in the user's locale.
 *
 * Sorted with localeCompare rather than by code or by raw string order,
 * because "Åland" and "Côte d’Ivoire" sort where a reader expects only under a
 * collator.
 */
export const COUNTRIES: readonly CountryRef[] = TABLE.split(',')
  .map((entry) => {
    const i = entry.indexOf(':');
    const code = entry.slice(0, i);
    return { code, name: entry.slice(i + 1), flag: flagFor(code) };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

/** Lookup by alpha-2 code, case-insensitive. Undefined for an unknown code. */
export function countryByCode(code: string): CountryRef | undefined {
  const up = code.toUpperCase();
  return COUNTRIES.find((c) => c.code === up);
}
