/* ==================================================================
   BACKEND — CRM de Criadores · Pousada Aimê
   Google Apps Script, gratuito, ligado a uma Google Sheet dedicada.
   Mesma arquitetura do painel de reservas (crm-aime.html) — só que
   com uma planilha própria pra não misturar com o CRM de hóspedes.

   COMO INSTALAR (uma vez só):
   1. Crie uma Google Sheet nova, nomeie "CRM Criadores — Pousada Aimê".
   2. Renomeie a primeira aba pra "Leads".
   3. Na linha 1, cole exatamente estes cabeçalhos, uma por coluna, nesta ordem
      (copie a linha abaixo inteira e cole em A1 — o Sheets separa por TAB):

      id	data_envio	nome	instagram	whatsapp	email	seguidores	engajamento	localizacao	categoria_autodeclarada	portfolio_link	categoria_final	status	fonte	num_pessoas	criterios_ok	termo_enviado_em	termo_assinado_em	hospede_nome	hospede_cpf	acompanhantes_nome_cpf	telefone	placa_carro	quarto_cozinha	checkin	checkout	drive_link	entregavel_combinado	prazo_entrega	entregou	quer_marcado	data_aviso_publicacao	qualificado	qualificado_em	evento_meta_enviado	obs

   4. Menu Extensões → Apps Script. Apague o conteúdo do Code.gs e cole este arquivo inteiro.
   5. Menu Configurações do projeto (ícone de engrenagem) → em "Propriedades do script",
      adicione uma propriedade: chave = META_ACCESS_TOKEN, valor = o mesmo token de sistema
      que já usamos pra publicar no Instagram (META_SYSTEM_USER_TOKEN em
      ~/.config/vha-vibe-marketing/.env). Ele precisa ter permissão ads_management
      no Business Manager pra poder mandar evento pro pixel.
      NUNCA cole esse token direto no código nem no HTML — só aqui, em Propriedades do script.
   6. Implantar → Nova implantação → tipo "Aplicativo da Web".
      Executar como: Eu. Quem pode acessar: Qualquer pessoa.
      Implantar, autorizar o acesso, e copiar a URL que termina em /exec.
   7. Cole essa URL nas 2 constantes SHEETS_URL de formulario-criadores.html e painel-criadores.html.

   Se precisar alterar o código depois: edite aqui, salve, e em "Implantar" →
   "Gerenciar implantações" → editar (ícone de lápis) → Nova versão → Implantar.
   (Só criar implantação nova quebra a URL que já está nos HTMLs — sempre reuse a mesma.)
================================================================== */

const SHEET_NAME = 'Leads';
const PIXEL_ID = '983368201398155'; // mesmo pixel da Aimê (Meta Ads)
const META_API_VERSION = 'v20.0';

/* ---------- ROTEAMENTO ---------- */

function doGet(e) {
  const action = e.parameter.action;
  if (action === 'listar') {
    return jsonResponse_({ registros: listarRegistros_() });
  }
  return jsonResponse_({ erro: 'ação desconhecida' });
}

function doPost(e) {
  let payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ erro: 'payload inválido' });
  }

  if (payload.action === 'novo_lead') {
    return jsonResponse_(criarLead_(payload));
  }
  if (payload.action === 'atualizar') {
    return jsonResponse_(atualizarLead_(payload));
  }
  return jsonResponse_({ erro: 'ação desconhecida' });
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- PLANILHA (genérico, dirigido pelo cabeçalho) ---------- */

function getSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

function getHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function listarRegistros_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const headers = getHeaders_(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function criarLead_(payload) {
  const sheet = getSheet_();
  const headers = getHeaders_(sheet);
  payload.id = 'C' + Date.now();
  payload.data_envio = new Date().toLocaleString('pt-BR');
  if (!payload.status) payload.status = 'Triagem';
  const row = headers.map(h => (payload[h] !== undefined ? payload[h] : ''));
  sheet.appendRow(row);
  return { ok: true, id: payload.id };
}

function atualizarLead_(payload) {
  const sheet = getSheet_();
  const headers = getHeaders_(sheet);
  const idCol = headers.indexOf('id');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, erro: 'sem registros' };

  const ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  let rowIndex = -1;
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(payload.id)) { rowIndex = i + 2; break; }
  }
  if (rowIndex === -1) return { ok: false, erro: 'id não encontrado' };

  const linhaAtual = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const registroAtual = {};
  headers.forEach((h, i) => { registroAtual[h] = linhaAtual[i]; });

  const jaQualificado = String(registroAtual.qualificado || '').toLowerCase() === 'sim';
  const eventoJaEnviado = String(registroAtual.evento_meta_enviado || '').toLowerCase() === 'sim';

  // aplica só os campos que vieram no payload, mantém o resto
  headers.forEach((h, i) => {
    if (payload[h] !== undefined) linhaAtual[i] = payload[h];
  });

  // dispara evento pra Meta só na transição de "não qualificado" -> "qualificado",
  // e só uma vez (evento_meta_enviado evita reenvio se salvar de novo depois)
  const ficouQualificadoAgora = String(payload.qualificado || '').toLowerCase() === 'sim';
  if (ficouQualificadoAgora && !jaQualificado && !eventoJaEnviado) {
    const registroFinal = {};
    headers.forEach((h, i) => { registroFinal[h] = linhaAtual[i]; });
    const enviado = enviarEventoMeta_(registroFinal);
    const qualIdx = headers.indexOf('qualificado_em');
    const eventoIdx = headers.indexOf('evento_meta_enviado');
    if (qualIdx > -1) linhaAtual[qualIdx] = new Date().toLocaleString('pt-BR');
    if (eventoIdx > -1) linhaAtual[eventoIdx] = enviado ? 'Sim' : 'Erro';
  }

  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([linhaAtual]);
  return { ok: true };
}

/* ---------- META CONVERSIONS API ---------- */

function sha256Hex_(input) {
  if (!input) return null;
  const normalizado = String(input).trim().toLowerCase();
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, normalizado);
  return bytes.map(b => {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function telefoneParaHash_(v) {
  if (!v) return null;
  let digitos = String(v).replace(/\D/g, '');
  if (digitos.length <= 11) digitos = '55' + digitos; // adiciona DDI Brasil se faltar
  return sha256Hex_(digitos);
}

/* Envia o evento 'CriadorQualificado' pro pixel via Conversions API (server-side).
   Não depende do navegador do criador — dispara quando você muda o status no painel. */
function enviarEventoMeta_(registro) {
  const token = PropertiesService.getScriptProperties().getProperty('META_ACCESS_TOKEN');
  if (!token) {
    Logger.log('META_ACCESS_TOKEN não configurado em Propriedades do script.');
    return false;
  }

  const userData = {};
  const emHash = sha256Hex_(registro.email);
  const phHash = telefoneParaHash_(registro.whatsapp || registro.telefone);
  if (emHash) userData.em = [emHash];
  if (phHash) userData.ph = [phHash];

  const body = {
    data: [{
      event_name: 'CriadorQualificado',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'system_generated',
      user_data: userData,
      custom_data: {
        content_category: registro.categoria_final || registro.categoria_autodeclarada || '',
        content_name: 'criador_qualificado'
      }
    }]
  };

  const url = `https://graph.facebook.com/${META_API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`;
  try {
    const resposta = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    const codigo = resposta.getResponseCode();
    Logger.log('Meta CAPI [%s]: %s', codigo, resposta.getContentText());
    return codigo >= 200 && codigo < 300;
  } catch (err) {
    Logger.log('Erro ao enviar evento pra Meta: ' + err);
    return false;
  }
}
