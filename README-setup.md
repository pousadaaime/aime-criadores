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

### 4. Publicar
- **Formulário** (público): precisa de uma URL real pra rodar o Pixel e receber criadores. Mais simples: subir num site Netlify novo (mesmo esquema dos outros sites da Aimê) ou adicionar como uma página nova dentro de um repo já existente.
- **Painel** (uso só seu): pode ficar no mesmo site, numa URL que você não divulga, ou até aberto localmente no navegador — funciona igual, só perde o acesso de qualquer lugar.

Me chama quando estiver pronta pra publicar que eu ajudo a subir — não fiz isso ainda porque falta a URL do Apps Script (passo 2), que só você consegue gerar (exige login Google).

### 5. Testar antes de divulgar
1. Preencha o formulário publicado uma vez com dado de teste.
2. Confira no Gerenciador de Eventos da Meta (aba "Testar eventos") se o evento `Lead` chegou.
3. Abra o painel, veja se o registro apareceu, mude o status pra "Aprovado", marque como **Qualificado** e salve.
4. No Apps Script, **Execuções** (ícone de relógio na lateral) → confira se `enviarEventoMeta_` rodou sem erro. Se dar erro de permissão no token, revise o passo 2.3.

---

## O que ficou de propósito fora do escopo (por enquanto)

- **Automação de WhatsApp** (IA respondendo o criador automaticamente) — é uma peça separada, ver conversa sobre isso. Este sistema aqui é só formulário + painel + Sheets + Meta.
- **Hospedagem/deploy real** — os arquivos estão prontos, mas publicá-los é uma ação que temos que confirmar juntas (é conteúdo público, com PII de verdade depois que criadores reais preencherem).
