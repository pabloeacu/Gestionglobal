// _shared/arca.ts · cliente SOAP nativo para WSAA + WSFEv1 (AFIP/ARCA).
// Sin SDKs externos: firma PKCS#7 con node-forge, POST SOAP a AFIP.
// Cita: doc 02 §4 (WSAA+WSFE), §4.4 (E41 calcDoc), §4.5 (retry transient),
// P-ARCA-01 (cache TA), D02 (intervalo emisión).

// node-forge corre en Deno via esm.sh con la flag ?target=deno.
// deno-lint-ignore-file no-explicit-any
// @ts-ignore - esm.sh sirve este módulo en runtime.
import forge from 'https://esm.sh/node-forge@1.3.1?target=deno';

export type Ambiente = 'homologacion' | 'produccion';

export interface WsaaResult {
  token: string;
  sign: string;
  expirationTime: string; // ISO
  generationTime: string;
}

const WSAA_URLS: Record<Ambiente, string> = {
  homologacion: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  produccion: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
};

const WSFE_URLS: Record<Ambiente, string> = {
  homologacion: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  produccion: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
};

// --------------------------------------------------------------------------
// WSAA · firma CMS y obtiene TA (token + sign).
// --------------------------------------------------------------------------
export async function wsaaLogin(opts: {
  ambiente: Ambiente;
  certPem: string;
  keyPem: string;
  service?: string;
}): Promise<WsaaResult> {
  const service = opts.service ?? 'wsfe';
  const generationTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const expirationTime = new Date(Date.now() + 12 * 3600 * 1000).toISOString();
  const uniqueId = Math.floor(Date.now() / 1000);

  const ltr =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header>` +
    `<uniqueId>${uniqueId}</uniqueId>` +
    `<generationTime>${generationTime}</generationTime>` +
    `<expirationTime>${expirationTime}</expirationTime>` +
    `</header>` +
    `<service>${service}</service>` +
    `</loginTicketRequest>`;

  const cert = forge.pki.certificateFromPem(opts.certPem);
  const key = forge.pki.privateKeyFromPem(opts.keyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(ltr, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: false });
  const cmsB64 = forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());

  const soapBody =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Header/>` +
    `<soapenv:Body><wsaa:loginCms><wsaa:in0>${cmsB64}</wsaa:in0></wsaa:loginCms></soapenv:Body>` +
    `</soapenv:Envelope>`;

  const res = await fetch(WSAA_URLS[opts.ambiente], {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    body: soapBody,
  });
  const xml = await res.text();
  if (!res.ok) {
    throw new Error(`WSAA HTTP ${res.status}: ${xml.slice(0, 800)}`);
  }
  // El loginCmsReturn viene como CDATA o como entities. Lo decodificamos.
  const ret = extractTag(xml, 'loginCmsReturn');
  if (!ret) {
    throw new Error(`WSAA respuesta sin loginCmsReturn: ${xml.slice(0, 800)}`);
  }
  const inner = decodeXmlEntities(ret);
  const token = extractTag(inner, 'token');
  const sign = extractTag(inner, 'sign');
  const expirationTimeR = extractTag(inner, 'expirationTime');
  const generationTimeR = extractTag(inner, 'generationTime');
  if (!token || !sign || !expirationTimeR) {
    throw new Error(`WSAA login incompleto: ${inner.slice(0, 800)}`);
  }
  return {
    token,
    sign,
    expirationTime: expirationTimeR,
    generationTime: generationTimeR ?? generationTime,
  };
}

// --------------------------------------------------------------------------
// WSFE · FEDummy (ping).
// --------------------------------------------------------------------------
export async function feDummy(ambiente: Ambiente): Promise<{
  appServer: string;
  dbServer: string;
  authServer: string;
}> {
  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body><FEDummy xmlns="http://ar.gov.afip.dif.FEV1/" /></soap:Body>` +
    `</soap:Envelope>`;
  const res = await fetch(WSFE_URLS[ambiente], {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'http://ar.gov.afip.dif.FEV1/FEDummy',
    },
    body,
  });
  const xml = await res.text();
  if (!res.ok) throw new Error(`WSFE FEDummy HTTP ${res.status}: ${xml.slice(0, 500)}`);
  return {
    appServer: extractTag(xml, 'AppServer') ?? '?',
    dbServer: extractTag(xml, 'DbServer') ?? '?',
    authServer: extractTag(xml, 'AuthServer') ?? '?',
  };
}

// --------------------------------------------------------------------------
// WSFE · FECompUltimoAutorizado.
// --------------------------------------------------------------------------
export async function feCompUltimoAutorizado(opts: {
  ambiente: Ambiente;
  token: string;
  sign: string;
  cuit: string;
  ptoVta: number;
  cbteTipo: number;
}): Promise<number> {
  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">` +
    `<soap:Body><ar:FECompUltimoAutorizado>` +
    `<ar:Auth><ar:Token>${esc(opts.token)}</ar:Token><ar:Sign>${esc(opts.sign)}</ar:Sign><ar:Cuit>${opts.cuit}</ar:Cuit></ar:Auth>` +
    `<ar:PtoVta>${opts.ptoVta}</ar:PtoVta><ar:CbteTipo>${opts.cbteTipo}</ar:CbteTipo>` +
    `</ar:FECompUltimoAutorizado></soap:Body></soap:Envelope>`;
  const res = await fetch(WSFE_URLS[opts.ambiente], {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado',
    },
    body,
  });
  const xml = await res.text();
  if (!res.ok) throw new Error(`WSFE FECompUltimoAutorizado HTTP ${res.status}: ${xml.slice(0, 500)}`);
  const errMsg = extractTag(xml, 'Msg');
  if (errMsg && /token|sign|cuit/i.test(errMsg)) {
    throw new Error(`WSFE auth error: ${errMsg}`);
  }
  const cbteNro = extractTag(xml, 'CbteNro');
  return cbteNro ? Number(cbteNro) : 0;
}

// --------------------------------------------------------------------------
// WSFE · FECAESolicitar.
// --------------------------------------------------------------------------
export interface IvaAlicuotaXml {
  Id: number; // 3=0%, 4=10.5%, 5=21%, 6=27%
  BaseImp: number;
  Importe: number;
}

export interface FECAESolicitarInput {
  ambiente: Ambiente;
  token: string;
  sign: string;
  cuit: string;
  ptoVta: number;
  cbteTipo: number;
  concepto: 1 | 2 | 3;
  docTipo: number; // 80 CUIT, 96 DNI, 99 CF
  docNro: number; // 0 si CF
  cbteDesde: number;
  cbteHasta: number;
  cbteFch: string; // YYYYMMDD
  impTotal: number;
  impTotConc: number; // no gravado
  impNeto: number;
  impOpEx: number; // exento
  impIVA: number;
  impTrib: number; // 0 usualmente
  moneda: 'PES' | 'DOL';
  cotizacion: number;
  alicuotas: IvaAlicuotaXml[];
  fchServDesde?: string;
  fchServHasta?: string;
  fchVtoPago?: string;
}

export interface FECAESolicitarOutput {
  resultado: 'A' | 'P' | 'R' | string;
  cae?: string;
  caeFchVto?: string; // YYYYMMDD
  cbteDesde?: number;
  cbteHasta?: number;
  observaciones: Array<{ code: number; msg: string }>;
  errores: Array<{ code: number; msg: string }>;
  rawRequest: string;
  rawResponse: string;
}

export async function feCAESolicitar(input: FECAESolicitarInput): Promise<FECAESolicitarOutput> {
  const a = input;
  const alicuotasXml = a.alicuotas.length === 0
    ? ''
    : `<ar:Iva>${a.alicuotas
        .map(
          (al) =>
            `<ar:AlicIva><ar:Id>${al.Id}</ar:Id><ar:BaseImp>${fmt2(al.BaseImp)}</ar:BaseImp><ar:Importe>${fmt2(al.Importe)}</ar:Importe></ar:AlicIva>`,
        )
        .join('')}</ar:Iva>`;
  const serv = (a.concepto === 2 || a.concepto === 3) && a.fchServDesde && a.fchServHasta && a.fchVtoPago
    ? `<ar:FchServDesde>${a.fchServDesde}</ar:FchServDesde><ar:FchServHasta>${a.fchServHasta}</ar:FchServHasta><ar:FchVtoPago>${a.fchVtoPago}</ar:FchVtoPago>`
    : '';

  const fer =
    `<ar:FeCAEReq>` +
    `<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${a.ptoVta}</ar:PtoVta><ar:CbteTipo>${a.cbteTipo}</ar:CbteTipo></ar:FeCabReq>` +
    `<ar:FeDetReq><ar:FECAEDetRequest>` +
    `<ar:Concepto>${a.concepto}</ar:Concepto>` +
    `<ar:DocTipo>${a.docTipo}</ar:DocTipo><ar:DocNro>${a.docNro}</ar:DocNro>` +
    `<ar:CbteDesde>${a.cbteDesde}</ar:CbteDesde><ar:CbteHasta>${a.cbteHasta}</ar:CbteHasta>` +
    `<ar:CbteFch>${a.cbteFch}</ar:CbteFch>` +
    `<ar:ImpTotal>${fmt2(a.impTotal)}</ar:ImpTotal>` +
    `<ar:ImpTotConc>${fmt2(a.impTotConc)}</ar:ImpTotConc>` +
    `<ar:ImpNeto>${fmt2(a.impNeto)}</ar:ImpNeto>` +
    `<ar:ImpOpEx>${fmt2(a.impOpEx)}</ar:ImpOpEx>` +
    `<ar:ImpIVA>${fmt2(a.impIVA)}</ar:ImpIVA>` +
    `<ar:ImpTrib>${fmt2(a.impTrib)}</ar:ImpTrib>` +
    serv +
    `<ar:MonId>${a.moneda}</ar:MonId><ar:MonCotiz>${a.cotizacion}</ar:MonCotiz>` +
    alicuotasXml +
    `</ar:FECAEDetRequest></ar:FeDetReq>` +
    `</ar:FeCAEReq>`;

  const body =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">` +
    `<soap:Body><ar:FECAESolicitar>` +
    `<ar:Auth><ar:Token>${esc(a.token)}</ar:Token><ar:Sign>${esc(a.sign)}</ar:Sign><ar:Cuit>${a.cuit}</ar:Cuit></ar:Auth>` +
    fer +
    `</ar:FECAESolicitar></soap:Body></soap:Envelope>`;

  const res = await fetch(WSFE_URLS[a.ambiente], {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'http://ar.gov.afip.dif.FEV1/FECAESolicitar',
    },
    body,
  });
  const xml = await res.text();

  const resultado = extractTag(xml, 'Resultado') ?? 'R';
  const cae = extractTag(xml, 'CAE') ?? undefined;
  const caeFchVto = extractTag(xml, 'CAEFchVto') ?? undefined;
  const cbteDesdeR = extractTag(xml, 'CbteDesde');
  const cbteHastaR = extractTag(xml, 'CbteHasta');
  const observaciones = extractAllPairs(xml, 'Obs', 'Code', 'Msg');
  const errores = extractAllPairs(xml, 'Err', 'Code', 'Msg');

  return {
    resultado,
    cae,
    caeFchVto,
    cbteDesde: cbteDesdeR ? Number(cbteDesdeR) : undefined,
    cbteHasta: cbteHastaR ? Number(cbteHastaR) : undefined,
    observaciones,
    errores,
    rawRequest: body,
    rawResponse: xml,
  };
}

// --------------------------------------------------------------------------
// calcDoc · defensa en profundidad (E41).
// --------------------------------------------------------------------------
export function calcDoc(tipoDoc: string, numeroDoc: string): { docTipo: number; docNro: number } {
  if (tipoDoc === 'cuit' && /^\d{11}$/.test(numeroDoc)) return { docTipo: 80, docNro: Number(numeroDoc) };
  if ((tipoDoc === 'dni' || tipoDoc === 'dni_ficticio') && /^\d{7,8}$/.test(numeroDoc)) {
    return { docTipo: 96, docNro: Number(numeroDoc) };
  }
  return { docTipo: 99, docNro: 0 };
}

// Mapa tipo string interno → CbteTipo AFIP.
export function tipoToCbte(tipo: string): number {
  switch (tipo) {
    case 'A': return 1;
    case 'B': return 6;
    case 'C': return 11;
    case 'NC_A': return 3;
    case 'NC_B': return 8;
    case 'NC_C': return 13;
    case 'ND_A': return 2;
    case 'ND_B': return 7;
    case 'ND_C': return 12;
    default: throw new Error(`tipo ${tipo} no autorizable por ARCA en este flujo`);
  }
}

// AFIP alícuota IDs: 3=0%, 4=10.5%, 5=21%, 6=27%
export function alicuotaToId(alic: string): number | null {
  switch (alic) {
    case '0': return 3;
    case '10.5': return 4;
    case '21': return 5;
    case '27': return 6;
    default: return null;
  }
}

// --------------------------------------------------------------------------
// Retry transient (P-API-04 / §4.5).
// --------------------------------------------------------------------------
const TRANSIENT_PATTERNS = [
  /HTTP[\s_]?5\d\d/i, /timeout/i, /network/i, /connection/i, /ECONNRESET/i,
  /WSAA[_\s]?FAULT/i, /WSFE[_\s]?FAULT/i,
  /ya posee TA/i, /comprobante ya registrado/i,
];

export function isTransientArcaError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? String(err);
  return TRANSIENT_PATTERNS.some((re) => re.test(msg));
}

// --------------------------------------------------------------------------
// CSR · generar par RSA 2048 + CSR PKCS#10 firmado.
// --------------------------------------------------------------------------
export interface CsrInput {
  cuit: string;
  razonSocial: string;
  alias?: string; // CN del CSR. Default: gestion-global-{cuit}
}
export function generarCsrPkcs10(input: CsrInput): { csrPem: string; keyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = keys.publicKey;
  csr.setSubject([
    { name: 'commonName', value: input.alias ?? `gestion-global-${input.cuit}` },
    { name: 'countryName', value: 'AR' },
    { name: 'organizationName', value: input.razonSocial },
    { shortName: 'serialName', value: `CUIT ${input.cuit}` },
  ]);
  csr.sign(keys.privateKey, forge.md.sha256.create());
  return {
    csrPem: forge.pki.certificationRequestToPem(csr),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

export interface InspectCertResult {
  ok: boolean;
  validoDesde?: string; // ISO date
  validoHasta?: string;
  subjectCN?: string;
  cuitInSubject?: string;
  matchKey?: boolean;
  error?: string;
}

export function inspeccionarCert(certPemOrB64: string, keyPem: string): InspectCertResult {
  try {
    const certPem = certPemOrB64.includes('BEGIN CERTIFICATE')
      ? certPemOrB64
      : pemDecodeAndRePem(certPemOrB64, 'CERTIFICATE');
    const cert = forge.pki.certificateFromPem(certPem);
    const validoDesde = cert.validity.notBefore.toISOString().slice(0, 10);
    const validoHasta = cert.validity.notAfter.toISOString().slice(0, 10);
    const cnAttr = cert.subject.getField('CN');
    const subjectCN = cnAttr?.value;
    let cuitInSubject: string | undefined;
    // serialNumber suele venir como "CUIT 20123456789"
    const serial = cert.subject.getField({ name: 'serialName' }) || cert.subject.getField('serialNumber');
    if (serial?.value) {
      const m = String(serial.value).match(/(\d{11})/);
      if (m) cuitInSubject = m[1];
    }
    // matchKey: comparar modulus de la public key del cert con la pública derivada del private key.
    let matchKey = false;
    try {
      const priv = forge.pki.privateKeyFromPem(keyPem);
      const pub = cert.publicKey as any;
      matchKey = priv.n && pub.n ? priv.n.toString(16) === pub.n.toString(16) : false;
    } catch { matchKey = false; }

    return { ok: true, validoDesde, validoHasta, subjectCN, cuitInSubject, matchKey };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// --------------------------------------------------------------------------
// Utils.
// --------------------------------------------------------------------------
function esc(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
function fmt2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}
function extractTag(xml: string, tag: string): string | null {
  // Acepta prefijos namespace (ej. <ar:CAE> o <CAE>).
  const re = new RegExp(`<(?:[a-zA-Z][\\w-]*:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z][\\w-]*:)?${tag}>`, 'i');
  const m = xml.match(re);
  return m ? decodeXmlEntities(m[1]!.trim()) : null;
}
function extractAllPairs(xml: string, container: string, codeTag: string, msgTag: string): Array<{ code: number; msg: string }> {
  const re = new RegExp(`<(?:[a-zA-Z][\\w-]*:)?${container}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z][\\w-]*:)?${container}>`, 'gi');
  const out: Array<{ code: number; msg: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const inner = m[1]!;
    // Cada Obs/Err contiene N <{codeTag}><Msg>... → iterar.
    const subRe = new RegExp(`<(?:[a-zA-Z][\\w-]*:)?${codeTag}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z][\\w-]*:)?${codeTag}>\\s*<(?:[a-zA-Z][\\w-]*:)?${msgTag}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z][\\w-]*:)?${msgTag}>`, 'gi');
    let sm: RegExpExecArray | null;
    while ((sm = subRe.exec(inner))) {
      out.push({ code: Number(sm[1]!.trim()), msg: decodeXmlEntities(sm[2]!.trim()) });
    }
  }
  return out;
}
function decodeXmlEntities(s: string): string {
  return s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}
function pemDecodeAndRePem(b64: string, kind: 'CERTIFICATE' | 'PRIVATE KEY'): string {
  // Si nos pasaron base64 puro del cert (sin -----BEGIN-----), lo re-encadenamos.
  const clean = b64.replace(/\s+/g, '');
  const lines = clean.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${kind}-----\n${lines.join('\n')}\n-----END ${kind}-----\n`;
}

export function pemToB64(pem: string): string {
  // Guardamos PEM completo en b64 para que persista tal cual.
  return btoa(pem);
}
export function b64ToPem(b64: string): string {
  return atob(b64);
}
