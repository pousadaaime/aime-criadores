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

   4. Crie uma SEGUNDA aba na mesma planilha, nomeie "Conversas". Cole na linha 1:

      telefone	etapa	ultima_mensagem	atualizado_em

   5. Menu Extensões → Apps Script. Apague o conteúdo do Code.gs e cole este arquivo inteiro.
   6. Menu Configurações do projeto (ícone de engrenagem) → em "Propriedades do script",
      adicione as propriedades:
      - META_ACCESS_TOKEN = o mesmo token de sistema que já usamos pra publicar no Instagram
        (META_SYSTEM_USER_TOKEN em ~/.config/vha-vibe-marketing/.env), com permissão ads_management.
      - WHATSAPP_TOKEN = token de acesso do WhatsApp Cloud API (Meta for Developers).
      - WHATSAPP_PHONE_NUMBER_ID = ID do número de telefone no WhatsApp Business Platform.
      - WHATSAPP_VERIFY_TOKEN = uma senha inventada por você (qualquer string), usada só na
        configuração do webhook — a Meta te pede pra confirmar essa mesma string no painel dela.
      - WHATSAPP_NOTIFICAR = seu número pessoal (com DDI+DDD, só dígitos) — recebe aviso quando
        uma mensagem foge do roteiro automático.
      - GEMINI_API_KEY = opcional, chave grátis em aistudio.google.com/apikey — usada só quando
        a resposta do criador foge do roteiro (não é "sim"/"não" claro).
      NUNCA cole esses valores direto no código nem no HTML — só aqui, em Propriedades do script.
   7. Implantar → Nova implantação → tipo "Aplicativo da Web".
      Executar como: Eu. Quem pode acessar: Qualquer pessoa.
      Implantar, autorizar o acesso, e copiar a URL que termina em /exec.
   8. Cole essa URL nas 2 constantes SHEETS_URL de formulario-criadores.html e painel-criadores.html.
   9. No Meta for Developers, configure o Webhook do WhatsApp apontando pra essa mesma URL
      (a mesma do passo 8), com o Verify Token igual ao WHATSAPP_VERIFY_TOKEN do passo 6.
      Inscreva o campo "messages".

   Se precisar alterar o código depois: edite aqui, salve, e em "Implantar" →
   "Gerenciar implantações" → editar (ícone de lápis) → Nova versão → Implantar.
   (Só criar implantação nova quebra a URL que já está nos HTMLs e no Webhook — sempre reuse a mesma.)
================================================================== */

const SHEET_NAME = 'Leads';
const CONVERSAS_SHEET_NAME = 'Conversas';
const PIXEL_ID = '983368201398155'; // mesmo pixel da Aimê (Meta Ads)
const META_API_VERSION = 'v20.0';

/* Resumo do processo pra IA usar como referência quando a resposta do criador foge do
   roteiro (sim/não). ATUALIZE ISSO MANUALMENTE sempre que processo-criadores.md mudar —
   o Apps Script não tem acesso ao Obsidian, roda só com o que está escrito aqui. */
const BASE_CONHECIMENTO = `
A Pousada Aimê (Maresias) oferece hospedagem em regime de permuta pra criadores de conteúdo.
Categorias: Influenciador (>10k seguidores + engajamento bom + audiência de SP) ou UGC (bom conteúdo pra anúncio, avaliado pelo portfólio).
Entregável UGC: 2 Reels + 1 sequência de 8 stories orgânicos, 2 diárias (noite).
Entregável Influenciador: base igual ao UGC (criador + 1 acompanhante); cada pessoa extra até 4 no total soma +1 Reels e +1 sequência de stories; acima de 4 pessoas, desconto de 40% na diária por acompanhante extra em vez de mais entregável.
Nunca inclui restaurante/café da manhã (terceirizado, sem parceria). Quarto com cozinha = aloca no loft (até 6 pessoas).
Prazo de entrega: até 5 dias corridos após a hospedagem. Direito de uso: vitalício, orgânico e anúncio.
Reagendamento: até 15 dias de antecedência; fora disso perde o direito de remarcar.
`;

/* ---------- ROTEAMENTO ---------- */

function doGet(e) {
  // handshake de verificação do Webhook do WhatsApp
  if (e.parameter['hub.mode'] === 'subscribe') {
    const tokenEsperado = PropertiesService.getScriptProperties().getProperty('WHATSAPP_VERIFY_TOKEN');
    if (e.parameter['hub.verify_token'] === tokenEsperado) {
      return ContentService.createTextOutput(e.parameter['hub.challenge']);
    }
    return ContentService.createTextOutput('token inválido');
  }

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

  // mensagem recebida via WhatsApp Cloud API
  if (payload.object === 'whatsapp_business_account') {
    processarWebhookWhatsApp_(payload);
    return jsonResponse_({ ok: true });
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

/* ==================================================================
   AUTOMAÇÃO DE WHATSAPP — MVP: só a abertura (scripts 1b/2a/2b do
   scripts-whatsapp-criadores.md). O resto do processo (termo, dados de
   check-in, confirmação, cobrança) continua manual por enquanto.
================================================================== */

const MSG_2A = `Oi! Tudo bem? Aqui é da Pousada Aimê, em Maresias 🌿

A gente trabalha com parceria de permuta pra criadores de conteúdo — hospedagem em troca de conteúdo combinado.

Seria interessante pra você?`;

const MSG_2B = `Pra eu avaliar direitinho o seu perfil, preenche esse formulário rapidinho: https://pousadaaime.github.io/aime-criadores/

As análises acontecem mensalmente, e às vezes semanalmente quando abre vaga. Se eu não retornar nas próximas semanas, seu portfólio será avaliado dentro dos próximos 30 dias 🙂`;

const MSG_RECUSA = `Sem problemas, obrigada por responder! Se mudar de ideia é só chamar por aqui 🌿`;

const MSG_HANDOFF = `Só um instante que já te retorno por aqui 🙂`;

function processarWebhookWhatsApp_(payload) {
  try {
    const value = payload.entry[0].changes[0].value;
    const mensagens = value.messages;
    if (!mensagens || !mensagens.length) return; // status de entrega, não é mensagem nova

    const msg = mensagens[0];
    const telefone = msg.from;
    const texto = (msg.text && msg.text.body) ? msg.text.body.trim() : '';
    if (!texto) return; // ignora mídia/áudio por enquanto

    processarMensagem_(telefone, texto);
  } catch (err) {
    Logger.log('Erro ao processar webhook do WhatsApp: ' + err);
  }
}

function processarMensagem_(telefone, texto) {
  const estado = getEstadoConversa_(telefone);
  const textoLower = texto.toLowerCase();
  const afirmativo = /\b(sim|quero|topo|top|claro|com certeza|bora|manda|vamos|pode)\b/.test(textoLower);
  const negativo = /\b(não|nao|agora não|talvez depois)\b/.test(textoLower);

  if (!estado) {
    enviarMensagemWhatsApp_(telefone, MSG_2A);
    salvarEstadoConversa_(telefone, 'aguardando_interesse', texto);
    return;
  }

  if (estado.etapa === 'aguardando_interesse') {
    if (afirmativo) {
      enviarMensagemWhatsApp_(telefone, MSG_2B);
      salvarEstadoConversa_(telefone, 'formulario_enviado', texto);
    } else if (negativo) {
      enviarMensagemWhatsApp_(telefone, MSG_RECUSA);
      salvarEstadoConversa_(telefone, 'recusou', texto);
    } else {
      responderComIA_(telefone, texto);
      salvarEstadoConversa_(telefone, 'aguardando_interesse', texto);
    }
    return;
  }

  // fora do roteiro conhecido (já passou da abertura) — tenta IA, avisa a Luana
  responderComIA_(telefone, texto);
  salvarEstadoConversa_(telefone, estado.etapa, texto);
  notificarLuana_(`Mensagem fora do roteiro de ${telefone} (etapa: ${estado.etapa}): "${texto}"`);
}

function responderComIA_(telefone, texto) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    enviarMensagemWhatsApp_(telefone, MSG_HANDOFF);
    notificarLuana_(`Sem GEMINI_API_KEY configurada. Mensagem de ${telefone} precisa de resposta manual: "${texto}"`);
    return;
  }
  const resposta = chamarGemini_(apiKey, texto);
  if (resposta) {
    enviarMensagemWhatsApp_(telefone, resposta);
  } else {
    enviarMensagemWhatsApp_(telefone, MSG_HANDOFF);
    notificarLuana_(`IA falhou ao responder ${telefone}. Mensagem: "${texto}"`);
  }
}

function chamarGemini_(apiKey, pergunta) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const prompt = `Você é a atendente da Pousada Aimê respondendo um criador de conteúdo no WhatsApp, sobre parceria de permuta. Seja breve (2-4 frases), tom caloroso e direto, em português do Brasil. Use só as informações abaixo — se não souber responder com certeza, diga que vai confirmar e já volta.

INFORMAÇÕES:
${BASE_CONHECIMENTO}

PERGUNTA DO CRIADOR: ${pergunta}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }]
  };
  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    const data = JSON.parse(resp.getContentText());
    return data.candidates && data.candidates[0].content.parts[0].text.trim();
  } catch (err) {
    Logger.log('Erro ao chamar Gemini: ' + err);
    return null;
  }
}

function enviarMensagemWhatsApp_(telefone, texto) {
  const token = PropertiesService.getScriptProperties().getProperty('WHATSAPP_TOKEN');
  const phoneId = PropertiesService.getScriptProperties().getProperty('WHATSAPP_PHONE_NUMBER_ID');
  if (!token || !phoneId) {
    Logger.log('WHATSAPP_TOKEN ou WHATSAPP_PHONE_NUMBER_ID não configurados.');
    return false;
  }
  const url = `https://graph.facebook.com/${META_API_VERSION}/${phoneId}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: telefone,
    type: 'text',
    text: { body: texto }
  };
  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    const codigo = resp.getResponseCode();
    Logger.log('WhatsApp send [%s]: %s', codigo, resp.getContentText());
    return codigo >= 200 && codigo < 300;
  } catch (err) {
    Logger.log('Erro ao enviar WhatsApp: ' + err);
    return false;
  }
}

function notificarLuana_(texto) {
  const numero = PropertiesService.getScriptProperties().getProperty('WHATSAPP_NOTIFICAR');
  if (!numero) return;
  enviarMensagemWhatsApp_(numero, '🔔 ' + texto);
}

/* ---------- CONVERSAS (estado do bot por telefone) ---------- */

function getConversasSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONVERSAS_SHEET_NAME);
}

function getEstadoConversa_(telefone) {
  const sheet = getConversasSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const dados = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  for (let i = 0; i < dados.length; i++) {
    if (String(dados[i][0]) === String(telefone)) {
      return { linha: i + 2, telefone: dados[i][0], etapa: dados[i][1], ultima_mensagem: dados[i][2] };
    }
  }
  return null;
}

function salvarEstadoConversa_(telefone, etapa, ultimaMensagem) {
  const sheet = getConversasSheet_();
  const estado = getEstadoConversa_(telefone);
  const agora = new Date().toLocaleString('pt-BR');
  if (estado) {
    sheet.getRange(estado.linha, 2, 1, 3).setValues([[etapa, ultimaMensagem, agora]]);
  } else {
    sheet.appendRow([telefone, etapa, ultimaMensagem, agora]);
  }
}
