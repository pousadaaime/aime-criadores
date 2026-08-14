# Setup — Sistema de Criadores (formulário + painel + Meta)

> Mesma arquitetura do painel de reservas que você já usa (`crm-aime.html` / `aime-captura.html`): páginas HTML estáticas, sem servidor pago, com Google Sheets + Apps Script como banco de dados gratuito. Aqui usamos uma planilha própria, separada da de hóspedes.

Arquivos desta pasta:
- **`codigo-apps-script.gs`** — backend (roda no Google, grátis)
- **`formulario-criadores.html`** — formulário público (Meta Pixel embutido)
- **`painel-criadores.html`** — painel administrativo (pipeline, ficha, calendário, qualificação Meta)

Ver o processo que esse sistema automatiza em [[../processo-criadores|processo-criadores]].

---

## Passo a passo

### 1. Criar a planilha
1. Crie uma Google Sheet nova, nomeie **"CRM Criadores — Pousada Aimê"**.
2. Renomeie a primeira aba pra **"Leads"**.
3. Na célula A1, cole a linha de cabeçalhos que está no topo de `codigo-apps-script.gs` (é uma linha só, separada por tab — cole direto que o Sheets separa nas colunas sozinho).

### 2. Instalar o backend
1. Nessa mesma planilha: **Extensões → Apps Script**.
2. Apague o conteúdo padrão e cole o `codigo-apps-script.gs` inteiro.
3. **Configurações do projeto** (ícone de engrenagem) → **Propriedades do script** → adicionar:
   - Chave: `META_ACCESS_TOKEN`
   - Valor: o token de sistema que já usamos pra publicar no Instagram (`META_SYSTEM_USER_TOKEN`). Ele precisa ter permissão `ads_management` no Business Manager pra conseguir mandar evento pro pixel — se der erro 400 no log ao testar, é sinal de que falta essa permissão nesse token.
4. **Implantar → Nova implantação** → tipo "Aplicativo da Web" → Executar como **Eu** → Quem pode acessar **Qualquer pessoa** → Implantar.
5. Autorize o acesso quando pedir. Copie a URL final (termina em `/exec`).

### 3. Configurar as páginas
1. Abra `formulario-criadores.html` e `painel-criadores.html`.
2. Em ambos, cole a URL do passo anterior na constante `SHEETS_URL` (topo do `<script>`).
3. Em `painel-criadores.html`, troque a constante `SENHA` por uma senha real sua — a que está no arquivo é só placeholder.

### 4. Publicar — ✅ feito em 13/08/2026
- Repositório: [github.com/pousadaaime/aime-criadores](https://github.com/pousadaaime/aime-criadores) (público — precisou ser público porque GitHub Pages não funciona em repo privado no plano atual da org)
- Hospedagem: GitHub Pages, branch `main`, raiz `/`
- **Formulário (público):** https://pousadaaime.github.io/aime-criadores/
- **Painel (uso interno):** https://pousadaaime.github.io/aime-criadores/painel-criadores.html
- `SHEETS_URL` já preenchido nos dois HTMLs com a URL do Apps Script implantado.

✅ Senha do painel já trocada do placeholder — lembre que, como o repo é público, ela fica visível pra quem olhar o código-fonte (mesma fragilidade do `crm-aime.html`). Não reuse essa senha em nada mais sensível.

### 5. Testar antes de divulgar
1. Preencha o formulário publicado uma vez com dado de teste.
2. Confira no Gerenciador de Eventos da Meta (aba "Testar eventos") se o evento `Lead` chegou.
3. Abra o painel, veja se o registro apareceu, mude o status pra "Aprovado", marque como **Qualificado** e salve.
4. No Apps Script, **Execuções** (ícone de relógio na lateral) → confira se `enviarEventoMeta_` rodou sem erro. Se dar erro de permissão no token, revise o passo 2.3.

---

## 6. Automação de WhatsApp (MVP — só abertura 2a/2b)

> Escopo do MVP: responde o primeiro contato, pergunta se tem interesse, manda o link do formulário se confirmar. O resto (termo, dados de check-in, confirmação, cobrança) continua manual — decisão consciente pra testar a base antes de automatizar a parte que mexe com CPF/reserva real.

### 6.1 Preparar a planilha
1. Na mesma Google Sheet, crie uma **segunda aba** chamada **"Conversas"**.
2. Na célula A1 dessa aba, cole: `telefone	etapa	ultima_mensagem	atualizado_em`

### 6.2 Criar o app no Meta for Developers
1. Acesse [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Criar app** → tipo **Empresa**.
2. Dentro do app, adicione o produto **WhatsApp**.
3. Em "Configuração da API", associe o **número do chip novo da agência** (o fluxo pede o número + código de verificação por SMS/ligação).
4. Anote 2 valores que vão aparecer: **Phone number ID** e o **token de acesso temporário** (depois trocamos por um permanente via System User, igual já fizemos pro Instagram).

### 6.3 Configurar o Script Properties (Apps Script)
Voltando no mesmo projeto do Apps Script (Configurações do projeto → Propriedades do script), adicione:
- `WHATSAPP_TOKEN` — o token de acesso do passo 6.2
- `WHATSAPP_PHONE_NUMBER_ID` — o Phone number ID do passo 6.2
- `WHATSAPP_VERIFY_TOKEN` — invente uma senha qualquer (só precisa bater com o próximo passo)
- `WHATSAPP_NOTIFICAR` — seu número pessoal (só dígitos, com DDI 55) — recebe aviso quando uma mensagem foge do roteiro
- `GEMINI_API_KEY` — opcional, grátis em [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — sem essa chave, o bot ainda funciona pro roteiro fixo (2a/2b), só não tenta responder pergunta livre

Depois de adicionar, **Implantar → Gerenciar implantações → editar (lápis) → Nova versão → Implantar** (reusa a mesma URL — não cria implantação nova).

### 6.4 Configurar o Webhook no Meta for Developers
1. No mesmo app, em WhatsApp → Configuração → **Webhook**.
2. URL de callback: a mesma URL `/exec` do Apps Script (a que já está em `SHEETS_URL`).
3. Verify token: o mesmo valor que você colocou em `WHATSAPP_VERIFY_TOKEN`.
4. Clique em Verificar — se dar certo, marca os campos pra inscrever: escolha **messages**.

### 6.5 Testar
1. Mande uma mensagem qualquer pro número novo, de outro celular.
2. Deve chegar a resposta de abertura (script 1b/2a) automaticamente.
3. Responda "sim" — deve vir o link do formulário (script 2b).
4. Na planilha, aba "Conversas", confira se o número e a etapa foram registrados.
5. Se algo não responder, no Apps Script → **Execuções** (ícone de relógio) → veja o log de erro.

---

## O que ficou de propósito fora do escopo (por enquanto)

- **Resto do fluxo automatizado** (termo, dados de check-in, confirmação, cobrança) — só a abertura está automatizada. Ver Etapa 5 do [[../processo-criadores|processo]] pra essas partes, que continuam manuais.
- **IA "aprendendo sozinha"** — o fallback de IA (Gemini) responde com base no resumo fixo `BASE_CONHECIMENTO` dentro do `codigo-apps-script.gs`, que precisa ser atualizado manualmente quando o processo mudar. Não lê o Obsidian em tempo real (Apps Script roda na nuvem do Google, sem acesso ao computador local).
