// ---------------------------------------------------------------------------
// Templates de projeto para o Ares criar/scaffold (puro: só gera os arquivos em
// memória; quem escreve no disco é o code.ts, dentro das raízes permitidas).
// ---------------------------------------------------------------------------

export type TemplateKind = 'site' | 'pagina' | 'node'

export const TEMPLATE_KINDS: TemplateKind[] = ['site', 'pagina', 'node']

/** Normaliza um nome para slug de pasta/pacote (kebab-case, sem acentos). */
export function slug(name: string): string {
  return (
    String(name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'projeto'
  )
}

/** Título legível a partir do nome. */
export function titleCase(name: string): string {
  const t = String(name || '').trim()
  return t || 'Meu Site'
}

function siteTemplate(name: string): Record<string, string> {
  const title = titleCase(name)
  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${title} — site criado pelo Ares." />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header class="topo">
      <div class="container nav">
        <a class="marca" href="#">${title}</a>
        <nav>
          <a href="#sobre">Sobre</a>
          <a href="#recursos">Recursos</a>
          <a href="#contato">Contato</a>
        </nav>
      </div>
    </header>

    <main>
      <section class="hero">
        <div class="container">
          <p class="selo">✦ feito com o Ares</p>
          <h1>${title}</h1>
          <p class="sub">Um site simples, rápido e bonito — pronto para você editar.</p>
          <div class="acoes">
            <a class="botao" href="#recursos">Começar</a>
            <button id="curtir" class="botao ghost" type="button">Curtir 0</button>
          </div>
        </div>
      </section>

      <section id="recursos" class="recursos">
        <div class="container grade">
          <article class="card">
            <h3>⚡ Rápido</h3>
            <p>HTML, CSS e JavaScript puros. Sem build, sem dependências.</p>
          </article>
          <article class="card">
            <h3>📱 Responsivo</h3>
            <p>Se adapta ao celular, tablet e desktop com um layout fluido.</p>
          </article>
          <article class="card">
            <h3>🎨 Fácil de mudar</h3>
            <p>Cores e fontes em variáveis CSS no topo do <code>styles.css</code>.</p>
          </article>
        </div>
      </section>

      <section id="sobre" class="sobre">
        <div class="container">
          <h2>Sobre</h2>
          <p>
            Este projeto foi gerado pelo Ares. Edite <code>index.html</code> para o conteúdo,
            <code>styles.css</code> para o visual e <code>script.js</code> para a interação.
          </p>
        </div>
      </section>
    </main>

    <footer id="contato" class="rodape">
      <div class="container">
        <p>© <span id="ano"></span> ${title}. Todos os direitos reservados.</p>
      </div>
    </footer>

    <script src="script.js"></script>
  </body>
</html>
`

  const css = `:root {
  --cor-fundo: #0b1020;
  --cor-superficie: #141b2e;
  --cor-texto: #e7ecf5;
  --cor-suave: #9fb0c8;
  --cor-acento: #4ea1ff;
  --cor-acento-2: #7c5cff;
  --raio: 14px;
  --container: 1080px;
}

* { box-sizing: border-box; }

html, body { margin: 0; padding: 0; }

body {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: radial-gradient(1200px 600px at 80% -10%, #1b2748 0%, var(--cor-fundo) 60%);
  color: var(--cor-texto);
  line-height: 1.6;
}

.container { width: min(var(--container), 92vw); margin: 0 auto; }

.topo { position: sticky; top: 0; backdrop-filter: blur(8px); background: rgba(11, 16, 32, 0.6); border-bottom: 1px solid #ffffff14; }
.nav { display: flex; align-items: center; justify-content: space-between; padding: 16px 0; }
.marca { font-weight: 700; font-size: 1.1rem; color: var(--cor-texto); text-decoration: none; }
.nav nav a { color: var(--cor-suave); text-decoration: none; margin-left: 22px; }
.nav nav a:hover { color: var(--cor-texto); }

.hero { padding: 90px 0 70px; text-align: center; }
.selo { display: inline-block; color: var(--cor-acento); border: 1px solid #4ea1ff44; border-radius: 999px; padding: 4px 14px; font-size: .85rem; }
.hero h1 { font-size: clamp(2.2rem, 6vw, 4rem); margin: 14px 0 6px; background: linear-gradient(90deg, var(--cor-acento), var(--cor-acento-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.sub { color: var(--cor-suave); font-size: 1.15rem; max-width: 620px; margin: 0 auto; }
.acoes { display: flex; gap: 12px; justify-content: center; margin-top: 28px; flex-wrap: wrap; }

.botao { display: inline-block; cursor: pointer; border: none; border-radius: var(--raio); padding: 12px 22px; font-size: 1rem; font-weight: 600; color: #06122a; background: linear-gradient(90deg, var(--cor-acento), var(--cor-acento-2)); text-decoration: none; transition: transform .08s ease, filter .2s ease; }
.botao:hover { filter: brightness(1.08); transform: translateY(-1px); }
.botao.ghost { background: transparent; color: var(--cor-texto); border: 1px solid #ffffff33; }

.recursos { padding: 40px 0; }
.grade { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; }
.card { background: var(--cor-superficie); border: 1px solid #ffffff12; border-radius: var(--raio); padding: 22px; }
.card h3 { margin: 0 0 8px; }
.card p { color: var(--cor-suave); margin: 0; }
code { background: #ffffff14; padding: 2px 6px; border-radius: 6px; }

.sobre { padding: 50px 0 30px; }
.sobre h2 { font-size: 1.8rem; }
.sobre p { color: var(--cor-suave); max-width: 680px; }

.rodape { border-top: 1px solid #ffffff14; padding: 26px 0; color: var(--cor-suave); text-align: center; margin-top: 40px; }
`

  const js = `// Interação simples da página, sem dependências.
document.addEventListener('DOMContentLoaded', () => {
  // Ano atual no rodapé.
  const ano = document.getElementById('ano')
  if (ano) ano.textContent = String(new Date().getFullYear())

  // Botão de "curtir" com contador.
  const botao = document.getElementById('curtir')
  let curtidas = 0
  if (botao) {
    botao.addEventListener('click', () => {
      curtidas += 1
      botao.textContent = 'Curtir ' + curtidas
    })
  }
})
`

  const readme = `# ${title}

Site estático simples criado pelo **Ares**.

## Arquivos

- \`index.html\` — conteúdo da página.
- \`styles.css\` — visual (cores e fontes em variáveis no topo).
- \`script.js\` — interação (ano no rodapé e botão de curtir).

## Como ver

Abra o \`index.html\` no navegador, ou rode um servidor local:

\`\`\`bash
python3 -m http.server 8000
# depois acesse http://localhost:8000
\`\`\`
`

  return { 'index.html': html, 'styles.css': css, 'script.js': js, 'README.md': readme }
}

function pageTemplate(name: string): Record<string, string> {
  const title = titleCase(name)
  return {
    'index.html': `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 720px; margin: 60px auto; padding: 0 16px; line-height: 1.6; color: #1c2433; }
      h1 { color: #2563eb; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <p>Página criada pelo Ares. Edite este arquivo para começar.</p>
  </body>
</html>
`
  }
}

function nodeTemplate(name: string): Record<string, string> {
  const pkg = slug(name)
  return {
    'package.json': `${JSON.stringify(
      {
        name: pkg,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: { start: 'node index.js', test: 'node --test' }
      },
      null,
      2
    )}\n`,
    'index.js': `export function saudar(nome = 'mundo') {\n  return \`Olá, \${nome}!\`\n}\n\nif (import.meta.url === \`file://\${process.argv[1]}\`) {\n  console.log(saudar(process.argv[2]))\n}\n`,
    'test/index.test.js': `import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { saudar } from '../index.js'\n\ntest('sauda pelo nome', () => {\n  assert.equal(saudar('Ares'), 'Olá, Ares!')\n})\n`,
    '.gitignore': `node_modules\n*.log\n`,
    'README.md': `# ${titleCase(name)}\n\nProjeto Node criado pelo Ares.\n\n\`\`\`bash\nnode index.js SeuNome\nnpm test\n\`\`\`\n`
  }
}

const TEMPLATES: Record<TemplateKind, (name: string) => Record<string, string>> = {
  site: siteTemplate,
  pagina: pageTemplate,
  node: nodeTemplate
}

export function normalizeTemplate(kind: string): TemplateKind {
  const k = String(kind || '').toLowerCase().trim()
  if (k === 'pagina' || k === 'página' || k === 'page' || k === 'html') return 'pagina'
  if (k === 'node' || k === 'nodejs' || k === 'js') return 'node'
  return 'site'
}

/** Arquivos do template (puro). */
export function templateFiles(kind: string, name: string): Record<string, string> {
  return TEMPLATES[normalizeTemplate(kind)](name)
}
