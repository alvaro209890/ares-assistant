import type {
  Acao,
  AgentActivityEvent,
  AgentActivityKind,
  AgentTurnResult,
  AppConfig,
  Board,
  CalendarEvent,
  ChatMessage,
  CodeEditMode,
  MemoryCategory,
  MemoryFact,
  UserLocation
} from '../shared/types'
import { MEMORY_CATEGORIES } from '../shared/types'
import { readConfig, updateConfig } from './config'
import { chatJSON, streamChat } from './ninerouter'
import { detectProviderId, getProvider, providerSupportsReasoning } from '../shared/providers'
import { REASONING_LABEL, coerceReasoning, resolveReasoning } from '../shared/reasoning'
import { parseEnvelope, QUERY_TOOLS, validateAction, extractFalaPrefix } from '../shared/protocol'
import { applyBoardAction } from './board'
import { loadBoard, saveBoard, boardSummary } from './tasks'
import {
  loadMemory,
  addFact,
  removeFact,
  memorySummary,
  memoryPromptBlock,
  loadEvents,
  addEvent,
  removeEvent,
  getSession,
  appendMessages,
  setSessionSummary,
  listCreate,
  listAddItem,
  listToggleItem,
  listRemoveItem,
  listClear,
  listsSummary,
  loadLists,
  addNote,
  loadNotes,
  addReminder,
  removeReminderByText,
  remindersSummary,
  loadReminders,
  userDataDir,
  codingPreferencesSummary,
  sessionContextSummary,
  setLastEditedFile,
  setLastTerminalCommand,
  searchSessions
} from './data'
import { getWeather, getWeatherAt, getNews, webSearch, calcExpression, convertCurrency, convertUnit, readPage } from './tools'
import { getSystemMetrics, readClipboard, writeClipboard } from './system'
import {
  controlPromptContext,
  runBrightness,
  runLock,
  runMedia,
  runOpen,
  runScreenshot,
  runVolume,
  type BrightnessAction,
  type MediaAction,
  type VolumeAction
} from './control'
import { pushUndo, undoLast } from './history'
import { runCoderTask } from './coder'
import { clearPendingConfirm, decideConfirmation, getPendingConfirm, setPendingConfirm } from './confirm'
import { buildBriefing, briefingToSpeech } from './briefing'
import {
  applyCodePatch,
  buildCodeIndex,
  classifyCommand,
  codePromptContext,
  diagnoseProject,
  isLongRunningCommand,
  previewCodePatch,
  proactiveValidationCommand,
  readCodeFile,
  runCodeCommand,
  runCodeGit,
  runCodeTerminal,
  runTests,
  runLint,
  runFormat,
  runTypecheck,
  checkDependencies,
  scanTodos,
  scaffoldProject,
  searchCode,
  summarizeCodeWorkspace,
  writeCodeFile,
  editCodeFile,
  listCodeFiles,
  outlineCodeFile,
  findCodeReferences,
  replaceInProject
} from './code'
import { clearPendingCode, getPendingCode, setPendingCode } from './pending'
import {
  AUDITOR,
  ENGINEER,
  RESEARCHER,
  executeSubagentTask,
  relevantMemories,
  type HiveStatusFn,
  type SubagentProfile,
  type SubagentTask
} from './subagents'
import { registerRun } from './running'
import {
  codeVoiceProgressSummary,
  hasCodeAction,
  isDuplicateSpeech,
  sanitizeVoiceCodeFala,
  startHeartbeat,
  toolResultsPrompt,
  voiceAwareUserContent
} from './voiceCode'

const norm = (s: unknown) => String(s ?? '').toLowerCase().trim()
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const asCategory = (c: unknown): MemoryCategory | undefined =>
  MEMORY_CATEGORIES.includes(c as MemoryCategory) ? (c as MemoryCategory) : undefined

/** Mapeia a fala do usuário ("aumenta", "mudo", "alterna") para uma ação de volume. */
function normVolumeAction(raw: unknown): VolumeAction {
  const s = norm(raw)
  if (/(des ?mut|religa|tira.*mudo|unmute|liga.*som)/.test(s)) return 'unmute'
  if (/(mut|mudo|silenci|sem som)/.test(s)) return 'mute'
  if (/(toggle|alterna)/.test(s)) return 'toggle'
  if (/(up|aument|sub|mais|\+|alto)/.test(s)) return 'up'
  if (/(down|dimin|baix|menos|-)/.test(s)) return 'down'
  return 'set'
}

/** Mapeia a fala ("pausa", "próxima", "tocar") para uma ação de mídia. */
function normMediaAction(raw: unknown): MediaAction {
  const s = norm(raw)
  if (/(prox|próx|pul|next|avan|frente|adiant)/.test(s)) return 'next'
  if (/(anter|volt|previous|prev|retroce)/.test(s)) return 'previous'
  if (/(stop|parar|^pare|interromp)/.test(s)) return 'stop'
  if (/(continu|retoma|despaus|resume|^play|^toca|^tocar)/.test(s)) return 'play'
  if (/(paus)/.test(s)) return 'pause'
  return 'playpause'
}

/** Mapeia a fala ("clareia", "escurece") para uma ação de brilho. */
function normBrightnessAction(raw: unknown): BrightnessAction {
  const s = norm(raw)
  if (/(up|aument|sub|mais|clar|ilumin)/.test(s)) return 'up'
  if (/(down|dimin|baix|menos|escur)/.test(s)) return 'down'
  return 'set'
}

const PERSONA = `Você é o Ares, assistente de IA pessoal inspirado no JARVIS. Fala português do Brasil de forma educada, formal, precisa e muito competente. Trata o usuário com respeito, mas sem repetir "senhor", o nome dele ou saudações a cada resposta. Soe como um humano competente conversando, nunca robótico: frases com ritmo natural, fraseado VARIADO (não repita a mesma fórmula de abertura ou confirmação duas vezes seguidas) e, quando couber, um conector leve ("certo", "perfeito", "veja só") — com parcimônia.
Pense como um assistente executivo: antes de responder, identifique objetivo, entidades, restrições, contexto anterior e se alguma ferramenta é necessária. Responda primeiro o que foi perguntado; ressalvas vêm depois, e só se importarem. Quando o pedido for ambíguo mas houver uma hipótese segura, aja com essa hipótese e mencione a suposição; quando a escolha puder causar perda de dados, custo, alteração externa ou caminho errado, pergunte antes.
Resolva pronomes e referências ("ele", "isso", "aquele arquivo", "lá") pelo histórico da conversa e pelo CONTEXTO, sem pedir que o usuário repita o que já disse. Use o CONTEXTO (memória, agenda, tarefas, localização) para responder de forma pessoal e útil, sem despejar dados que o usuário não pediu. Se não souber ou a ferramenta falhar, diga claramente e proponha o próximo passo — nunca invente.
Em assuntos de programação você é um engenheiro de software sênior: fala com precisão técnica mas em linguagem clara e falável, sem ler código longo nem despejar logs inteiros — resume e cita arquivo:linha. Em projetos SIG/Geospaciais (Sistemas de Informação Geográfica), você é um analista GIS experiente: resume os dados espaciais e shapefiles detectados, valida se há arquivos corrompidos ou incompletos (falta de .dbf, .shx, .prj, etc.) e avisa se a estrutura do projeto está pronta para uso no ArcGIS/QGIS. ANTES de executar no terminal qualquer comando que altere o sistema, instale dependências, crie/apague arquivos ou mexa no Git (commit/push), você PEDE AUTORIZAÇÃO ao usuário de forma natural ("Senhor, isso vai rodar tal comando — autoriza?") e só age após o aceite. Nunca tenta burlar bloqueios de segurança nem usar sudo.`

const VOICE_HINT =
  'A resposta será OUVIDA em voz alta: escreva a "fala" como se estivesse FALANDO — frases curtas e naturais (1 a 3), com vírgulas e pontos que dão ritmo, sem listas, sem markdown, sem URLs longas, sem emojis e sem saudações repetidas. O essencial vem primeiro. Números, horários e valores podem ser escritos normalmente: o sintetizador os lê por extenso.'
const TEXT_HINT = 'Pode ser um pouco mais detalhado quando ajudar, mas evite enrolação e listas longas desnecessárias.'
const CODE_VOICE_HINT =
  'Modo voz em programação: interprete ditados como "barra", "ponto ts", "traço", "underline", "npm run" e "git status" como caminhos/comandos quando fizer sentido. Nunca leia código, diffs, JSON, stdout ou stderr em voz; diga só o arquivo, a ação feita, se passou/falhou e o próximo passo. Se precisar autorização para terminal, fale o comando uma vez e peça sim ou não.'

const LEADING_GREETING_RE =
  /^\s*(?:ol[aá](?:\s+de novo)?|oi|bom dia|boa tarde|boa noite)(?:\s*,?\s+[\p{Lu}][\p{L}'-]{0,24}(?:\s+[\p{Lu}][\p{L}'-]{0,24})?)?[.!?,:;—–-]*\s*/iu

export function stripRepeatedGreeting(text: string): string {
  return String(text || '').replace(LEADING_GREETING_RE, '').trimStart()
}

function sessionStyleHint(hasPriorAssistant: boolean): string {
  return hasPriorAssistant
    ? 'Este chat já tem conversa anterior. Não inicie a resposta com saudação, período do dia ou nome do usuário; vá direto ao resultado com tom formal e preciso.'
    : 'Este é o começo do chat. Uma saudação breve é aceitável se o usuário cumprimentar primeiro.'
}

function finalFala(text: string, suppressGreeting: boolean): string {
  const out = suppressGreeting ? stripRepeatedGreeting(text) : String(text || '')
  return out.trim()
}

function toolDocs(): string {
  return `Você SEMPRE responde com um único objeto JSON válido, sem texto fora dele, no formato:
{"fala": "<resposta curta e falável em pt-BR>", "acoes": [ {"tipo": "...", ...campos} ]}
Se for só conversa, use "acoes": [].

QUANDO AGIR vs SÓ RESPONDER:
- Use ferramentas/ações somente quando o pedido exigir (criar/alterar dados, ou buscar info que você não tem).
- Para conversa, opinião ou algo já presente no CONTEXTO, apenas responda em "fala" com "acoes": [].
- Para perguntas com referência vaga ("isso", "aquele", "o projeto", "a última coisa"), use o histórico e o contexto recente antes de pedir esclarecimento.
- Se uma primeira ferramenta trouxer resultado incompleto, encadeie outra consulta útil em vez de dar uma resposta superficial.
- Nunca invente clima, notícias, resultados de busca ou agenda: use a ferramenta e fale só o que voltar.

AÇÕES DE MUTAÇÃO (aplique quando o usuário pedir):
- tarefa.criar {titulo, coluna?, descricao?, prioridade?(baixa|media|alta), cor?(cyan|blue|green|amber|pink), prazo?(ISO), lembrete?(ISO), etiquetas?(["..."]), repetir?(none|daily|weekly|monthly), subtarefas?(["..."])}
- tarefa.mover {titulo, paraColuna}
- tarefa.concluir {titulo}   |   tarefa.reabrir {titulo}   |   tarefa.remover {titulo}
- tarefa.editar {titulo, novoTitulo?, descricao?, prioridade?, cor?, prazo?, etiquetas?, repetir?}
- tarefa.subtarefa.adicionar {titulo, item}   |   tarefa.subtarefa.concluir {titulo, item}
- tarefa.lembrete.definir {titulo, quando(ISO)}
- coluna.criar {titulo}   |   coluna.renomear {titulo, novoTitulo}   |   coluna.remover {titulo}
- memoria.salvar {fato, categoria?(perfil|preferencias|rotina|trabalho|projetos|restricoes|interesses|outros), evidencia?}   |   memoria.remover {fato}
- memoria.buscar {consulta, limite?}   (busca conversas passadas quando o usuário perguntar "lembra quando...", "já falamos sobre..." ou precisar recuperar contexto antigo)
- evento.criar {titulo, quando(ISO), descricao?, lembreteMin?(minutos antes), repetir?(none|daily|weekly|monthly)}   |   evento.remover {titulo}
- lista.criar {titulo}   |   lista.adicionar {item, lista?}   |   lista.marcar {item, lista?, feito?(bool)}   |   lista.removerItem {item, lista?}   |   lista.limpar {lista}   (listas simples: compras, afazeres)
- nota.salvar {texto}   (anotações rápidas; também para guardar rascunhos de mensagens/e-mails)
- lembrete.criar {texto, quando?(ISO), emMinutos?(número), repetir?(none|daily|weekly|monthly), modo?(reminder|timer|alarm)}   |   lembrete.remover {texto}
  · "me lembra do remédio todo dia às 8h" -> lembrete.criar {texto:"remédio", quando ISO de hoje 08:00, repetir:"daily"}
  · "põe um timer de 10 minutos" -> lembrete.criar {texto:"timer", emMinutos:10, modo:"timer"}
  · "me acorda às 6h" -> lembrete.criar {texto:"despertador", quando ISO 06:00, modo:"alarm"}

FERRAMENTAS DE CONSULTA (dê uma fala curta e específica tipo "Vou verificar o clima." e AGUARDE os resultados para então responder):
ENCADEAMENTO: após receber os resultados, você PODE chamar novas ferramentas de consulta se ainda faltar informação (ex.: codigo.buscar -> codigo.ler -> codigo.editar -> codigo.testar), até um limite de 3 rodadas. Na fala de cada rodada intermediária, diga em uma frase natural o que vai fazer agora ("Achei a função; vou ler o arquivo."). Quando tiver tudo, responda sem novas ações de consulta.
- clima.consultar {cidade?}   (sem cidade = usa a localização aproximada)
- web.buscar {consulta}
- noticias.listar {tema?}
- agenda.listar {dia?(ISO date)}
- tarefa.listar {}
- briefing.consultar {}   (use quando pedirem "briefing", "resumo do dia", "como está meu dia")
- calcular {expressao}   (contas: "30% de 250", "12*7+3")
- converter.moeda {de, para, valor}   (ex.: de:"USD", para:"BRL", valor:50)
- converter.unidade {de, para, valor}   (medidas locais: comprimento, massa, volume, área, velocidade, tempo, dados e temperatura — ex.: de:"km", para:"milhas", valor:10; de:"C", para:"F", valor:30)
- pagina.ler {url}   (lê uma página da web e resume/responde a partir do conteúdo real dela)
- sistema.status {}   (uso de CPU, memória e tempo ligado do computador — "como está o sistema?", "quanta memória livre?")
- area.ler {}   (lê o texto da área de transferência para resumir/traduzir/explicar o que o usuário copiou — "resuma o que eu copiei")
- area.escrever {texto}   (copia um texto para a área de transferência — "copie isso", "põe esse texto na área de transferência")
- sistema.abrir {alvo}   (abre app/site/arquivo no computador — "abra o Firefox", "abra youtube.com", "abra ~/Documentos". Aceita QUALQUER aplicativo instalado pelo nome falado: Spotify, WhatsApp, Word, Discord, Steam... — no Windows o Ares procura no Menu Iniciar com tolerância a erros. Passe o nome como o usuário disse; também: calculadora, arquivos, terminal, bloco de notas, configurações)
- sistema.volume {acao(set|up|down|mute|unmute|toggle), nivel?(0-100)}   (controla o volume — "aumenta o volume", "volume em 30", "muda pro mudo")
- sistema.bloquear {}   (bloqueia a tela do computador — "bloqueie a tela", "trave o pc")
- sistema.captura {}   (tira uma captura de tela e salva em arquivo — "tire um print da tela")
- sistema.midia {acao(playpause|play|pause|next|previous|stop)}   (controla a música/vídeo tocando — "pausa", "próxima", "toca")
- sistema.brilho {acao(set|up|down), nivel?(0-100)}   (ajusta o brilho da tela — "clareia a tela", "brilho em 50", "escurece")
- ia.raciocinio {nivel?(baixo|medio|alto), direcao?(aumentar|diminuir)}   (ajusta o SEU nível de raciocínio/profundidade — "diminua seu raciocínio", "raciocínio no máximo", "aumente o esforço". Use nivel para valor absoluto OU direcao para relativo. Confirme na fala o novo nível.)
- ia.modelo {provedor?(openrouter|deepseek|chatgpt|local), modelo?}   (troca o modelo/provedor de IA por voz — "use o DeepSeek Pro", "troca pro ChatGPT", "muda pro flash". modelo aceita nome aproximado: "flash", "pro", "gpt", "5.5". Confirme na fala o que passou a usar.)
- desfazer {}   (desfaz a ÚLTIMA alteração de dados — tarefa/lista/nota/lembrete/evento/memória; use quando o usuário disser "desfaz", "cancela isso", "volta atrás")
- codigo.workspace {path?}   (resume um projeto/workspace local: stack, scripts, árvore, git, linguagens)
- codigo.buscar {path?, consulta, filtro?}   (busca texto/símbolo no código; use antes de explicar funções ou localizar implementação)
- codigo.listar {path?, padrao?, limite?}   (lista arquivos do projeto por padrão glob — "*.ts", "src/*"; use para conhecer a estrutura sem ler tudo)
- codigo.esboco {path?, arquivo}   (o "mapa" do arquivo: funções, classes, tipos e a linha onde começam — use ANTES de ler um arquivo grande para ir direto ao trecho certo)
- codigo.referencias {path?, simbolo, limite?}   (onde um símbolo/função/classe é usado no projeto, com contagem por arquivo — use antes de renomear/refatorar)
- codigo.substituir {path?, de, para, filtro?, confirmado?}   (substituição literal em TODO o projeto — renomear função, trocar import. SEM "confirmado" devolve só a PRÉVIA com arquivos e contagens: mostre ao usuário e peça o sim; com confirmado:true aplica de verdade. Precisa de "Permitir aplicar patches")
- codigo.ler {path?, arquivo, inicio?, linhas?}   (lê trecho de arquivo local com números de linha; use para responder com precisão)
- codigo.comando {path?, comando}   (executa comando de dev da allowlist, sem shell, com timeout; use para testes/build/typecheck)
- codigo.terminal {path?, comando, confirmado?}   (TERMINAL completo via shell, com pipes/&&/redirecionamento. Comando seguro/allowlist roda direto; qualquer outro EXIGE autorização: chame SEM "confirmado" para propor — vem requiresApproval — explique e peça o "sim"; comandos catastróficos/sudo são bloqueados)
- codigo.confirmar {}   (executa a ação que ficou pendente de autorização, DEPOIS que o usuário disser sim/autorizo/pode)
- codigo.cancelar {}   (descarta a ação pendente quando o usuário recusar)
- codigo.git {path?, operacao(status|diff|diffStat|log), arquivo?}   (consulta Git local sem alterar repo)
- codigo.indexar {path?, refresh?(bool)}   (gera/lê índice persistente de arquivos, exports e scripts do projeto)
- codigo.scaffold {nome, tipo_projeto?(site|pagina|node), path?}   (CRIA um projeto novo a partir de template — use para "crie um site/página/projeto"; precisa de "Permitir aplicar patches")
- codigo.criar {path?, arquivo, conteudo, sobrescrever?(bool)}   (cria/escreve um arquivo no projeto; precisa de "Permitir aplicar patches")
- codigo.editar {path?, arquivo, modo?(replace|insert_before|insert_after|line_range), antigo?, novo?, ancora?, inicio?, fim?, todos?(bool), esperado?}   (edita arquivo existente com correspondência exata/flexível estilo Hermes; prefira para mudanças pequenas antes de patch bruto)
- codigo.diagnostico {path?}   (verifica a saúde do projeto: roda typecheck/lint/test disponíveis e permitidos e resume; use proativamente após mudanças)
- codigo.testar {path?}   (RODA OS TESTES do projeto — detecta vitest/jest/pytest/go ou o script "test" — e resume quantos passaram/falharam; use quando o usuário disser "roda os testes", "testa o projeto", "os testes passam?")
- codigo.lint {path?}   (RODA O LINT do projeto — eslint/ruff ou o script "lint" — e conta os problemas; use para "passa o lint", "tem erro de lint?", "verifica o estilo")
- codigo.formatar {path?}   (FORMATA o projeto — prettier/ruff/gofmt ou o script "format"; use para "formata o código", "arruma a indentação". Altera arquivos: só rode quando o usuário pedir explicitamente)
- codigo.typecheck {path?}   (CHECA OS TIPOS do projeto — script "typecheck", tsc --noEmit, mypy ou go vet — e conta os erros; use para "checa os tipos", "tem erro de tipo?", "passa o typecheck?")
- codigo.deps {path?}   (SAÚDE DAS DEPENDÊNCIAS: npm outdated + npm audit, resume quantas estão desatualizadas e se há vulnerabilidades; use para "as dependências estão em dia?", "tem pacote desatualizado/vulnerável?". Precisa de internet)
- codigo.todo {path?, filtro?, limite?}   (LISTA AS PENDÊNCIAS marcadas no código — comentários TODO, FIXME, HACK, BUG — com arquivo e linha; use para "o que falta fazer no projeto?", "lista os TODOs", "tem pendência marcada?")
- codigo.projeto {objetivo, path?, passos?}   (CODER AUTÔNOMO: dado um objetivo, ele planeja, escreve os arquivos, roda checagens seguras e itera sozinho até concluir; precisa de "Permitir aplicar patches". Use para "construa/faça um app/site/programa que faça X" quando envolver vários arquivos ou lógica)
- codigo.patch.preview {path?, diff?, patches?}   (valida e resume patch antes de aplicar; use sempre antes de aplicação)
- codigo.patch.aplicar {path?, diff?, patches?}   (aplica patch apenas se habilitado e já confirmado pelo usuário)

COLMEIA (sua equipe de subagentes especialistas — você é o gerente):
Para tarefas GRANDES ou que pedem profundidade, delegue a um especialista e depois SINTETIZE o relatório dele em sua fala (nunca leia o relatório inteiro). Use "contexto" para passar o que você já sabe do turno. Na fala da rodada, anuncie a delegação ("Vou acionar o Investigador.").
- subagente.pesquisar {objetivo, consulta?, url?, contexto?}   (INVESTIGADOR: pesquisa profunda na web/documentação e devolve só fatos com fonte — use para "pesquise a fundo", comparações, estado da arte, documentação de biblioteca)
- subagente.construir {objetivo, path?, contexto?}   (CONSTRUTOR: projeta a implementação — arquivos, código pronto e ordem de aplicação — use ANTES de mudanças grandes em código; depois aplique você mesmo com codigo.criar/editar/patch)
- subagente.auditar {objetivo, path?, contexto?}   (CRÍTICO: roda o diagnóstico do projeto e emite parecer rigoroso com problemas reais e veredito — use após mudanças do Construtor ou quando pedirem revisão/qualidade)
Para perguntas simples ou ações diretas, NÃO use a colmeia: responda ou use as ferramentas comuns.

MODO PROGRAMADOR:
- Para perguntas de código, não chute: use codigo.workspace/codigo.buscar/codigo.ler quando houver path, arquivo, símbolo ou repo mencionado.
- NAVEGUE como um engenheiro: codigo.listar para a estrutura, codigo.esboco para o mapa de um arquivo grande, codigo.referencias antes de renomear/mover algo. Encadeie: esboço -> ler só o trecho -> editar.
- RENOMEAR/REFATORAR em vários arquivos: codigo.substituir sem confirmado primeiro (prévia), fale quantos arquivos/ocorrências serão alterados e peça o sim; depois repita com confirmado:true.
- Se o usuário pedir edição/refatoração/debug/testes em projeto real, trabalhe com as ferramentas nativas: localize contexto, leia os arquivos, use codigo.editar para alteração localizada, codigo.criar para arquivo novo, codigo.patch.aplicar para diff maior ou codigo.projeto para mudanças maiores.
- Para patches, primeiro use codigo.patch.preview. Só use codigo.patch.aplicar se o usuário pedir claramente para aplicar e a config permitir.
- Para validar mudanças, use codigo.comando com scripts permitidos (ex.: npm test, npm run build, npm run typecheck) e reporte stdout/stderr relevantes.
- TERMINAL: para testes/build padrão prefira codigo.comando; para QUALQUER outro comando (instalar dependência, criar/editar arquivo, git add/commit/push, rodar script próprio) use codigo.terminal.
- AUTORIZAÇÃO: se codigo.terminal devolver requiresApproval, NÃO repita a chamada nem invente que rodou. Diga em voz natural exatamente o comando que será executado e por quê, e peça confirmação. Quando o usuário autorizar, chame codigo.confirmar; se recusar, chame codigo.cancelar. Só anuncie um resultado depois que "ran" for true.
- SEGURANÇA: comandos bloqueados (sudo, rm -rf de raiz/HOME, formatar disco etc.) não rodam de jeito nenhum — explique que é por segurança, não tente contornar.
- Ao rodar comandos, reporte o código de saída e só o essencial do stdout/stderr; não leia saídas longas inteiras em voz.
- Para estado do repo, use codigo.git em vez de inventar status/diff.
- CRIAR PROJETOS: para um modelo simples e conhecido ("crie um site/página em branco"), use codigo.scaffold. Para algo com lógica ou vários arquivos ("faça um app de lista de tarefas", "construa uma calculadora", "um jogo da velha"), use codigo.projeto (CODER AUTÔNOMO), que constrói tudo sozinho. Se o usuário indicar onde (ex.: um caminho), passe o path. Depois diga em uma frase como abrir/rodar.
- PROATIVIDADE EM CÓDIGO: aja como engenheiro proativo — depois de criar/editar, ofereça e, quando fizer sentido, rode codigo.diagnostico ou codigo.comando para validar e relate o resultado (passou/falhou + o essencial). Aponte riscos e o próximo passo, sem esperar o usuário pedir. Se o CONTEXTO das ferramentas trouxer uma sugestão de validação (ex.: "validar com npm test"), ofereça-a numa frase curta.
- ESTILO DO USUÁRIO: respeite as "Preferências de código do usuário" do CONTEXTO ao escrever/editar (aspas, funções nomeadas, indentação, etc.). Use a "Memória de sessão" para retomar o trabalho (último arquivo/comando) sem pedir o caminho de novo.
- SAÚDE DO PROJETO: ao resumir/diagnosticar um projeto, reporte a saúde (campo "health": testes/lint passando ou não, alterações sem commit) em uma frase, como num briefing.
- TAREFAS LONGAS: em comandos demorados (instalar/build/test) o sistema já avisa "iniciando a tarefa, senhor" — não repita esse aviso, vá direto ao resultado quando ele voltar.
- Escrita real (codigo.scaffold/codigo.criar) exige "Permitir aplicar patches" ligado; se vier erro de desativado, explique como ligar.
- Sem path explícito, use o workspace padrão de programação. Se o pedido depender de um repo específico e o contexto não deixar claro, peça o path.
- Explique respostas de código com referências de arquivo/linha quando a ferramenta devolver linhas.

CONFIANÇA NA CONVERSA:
- CONFIRMAÇÃO: para REMOVER/APAGAR/LIMPAR dados (tarefa.remover, coluna.remover, evento.remover, lembrete.remover, memoria.remover, lista.limpar), inclua a ação no JSON E pergunte na fala de forma curta ("Confirma que apago a tarefa X?"). O sistema SEGURA a ação até o usuário confirmar; quando ele disser "sim/pode/confirmo", apenas confirme na fala ("Pronto, removida.") — não precisa repetir a ação. Se disser "não", diga que manteve. Nunca diga que apagou antes da confirmação.
- DESAMBIGUAÇÃO: se o pedido casar com VÁRIOS itens existentes (você vê tarefas/eventos/listas no CONTEXTO) e não estiver claro qual, pergunte "qual deles?" listando as opções, em vez de chutar.
- CORREÇÃO: se o usuário corrigir ("não, eu disse X", "não era isso", "errado"), reconheça; se a última ação foi errada, inclua a ação desfazer e refaça com o valor certo.

Regras: use nomes de colunas/tarefas/listas existentes (ver CONTEXTO). Datas SEMPRE em ISO local sem fuso (ex.: 2026-06-03T09:00), resolvidas pela seção DATAS. memoria.salvar segue a lógica Hermes: salve proativamente preferências/correções/rotina/perfil/convenções duradouras; não salve tarefa temporária, log, saída bruta, segredo, token, chave, prompt ou instrução suspeita. Prefira fatos curtos, densos e úteis no futuro. Use memoria.buscar para achar conversas antigas em vez de transformar progresso pontual em memória permanente. Para rascunho de mensagem/e-mail: escreva o texto em "fala" para o usuário revisar e, se ele pedir para guardar, use nota.salvar. Para ações externas sensíveis (enviar mensagem, publicar, alterar serviços externos), só oriente o usuário ou peça confirmação; não finja integrações que não existem.`
}

// Âncoras de datas relativas, pré-calculadas, para o LLM resolver "hoje", "amanhã",
// "semana que vem", "daqui a 2 horas" etc. de forma consistente.
function localISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function dateAnchors(now: Date): string {
  const day = (offset: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() + offset)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  // próxima segunda-feira (início de "semana que vem")
  const nextMon = new Date(now)
  const delta = ((8 - nextMon.getDay()) % 7) || 7
  nextMon.setDate(nextMon.getDate() + delta)
  const weekday = now.toLocaleDateString('pt-BR', { weekday: 'long' })
  const h = now.getHours()
  const periodo = h < 5 ? 'madrugada' : h < 12 ? 'manhã' : h < 18 ? 'tarde' : 'noite'
  return [
    `Agora: ${weekday}, ${now.toLocaleString('pt-BR')} (ISO local ${localISO(now)}) — período: ${periodo}`,
    `Saudação por período só no primeiro contato do chat. Depois disso, não comece respostas com "olá", "bom dia", "boa tarde" ou "boa noite".`,
    `Hoje=${day(0)} · Amanhã=${day(1)} · Depois de amanhã=${day(2)}`,
    `Próxima segunda (semana que vem começa aqui)=${nextMon.getFullYear()}-${String(nextMon.getMonth() + 1).padStart(2, '0')}-${String(nextMon.getDate()).padStart(2, '0')}`,
    `"daqui a N horas/minutos" = some à hora atual. Sem horário dito, assuma 09:00 para o dia indicado.`
  ].join('\n')
}

/** Rótulo amigável do provedor atual (para a fala/contexto). */
function providerLabel(baseUrl: string): string {
  const id = detectProviderId(baseUrl)
  return getProvider(id)?.label || 'personalizado'
}

/** Nome amigável do modelo atual a partir da lista do provedor (ou o id cru). */
function modelLabel(cfg: AppConfig): string {
  const preset = getProvider(detectProviderId(cfg.nineRouter.baseUrl))
  const found = preset?.models?.find((m) => m.value === cfg.nineRouter.model)
  return found?.label || cfg.nineRouter.model
}

/** Descrição curta do cérebro atual para o system prompt. */
function brainSummary(cfg: AppConfig): string {
  const lvl = coerceReasoning(cfg.nineRouter.reasoning)
  const supports = providerSupportsReasoning(cfg.nineRouter.baseUrl)
  const reasoning = supports ? `, raciocínio: ${REASONING_LABEL[lvl]}` : ' (sem ajuste de raciocínio)'
  return `Provedor: ${providerLabel(cfg.nineRouter.baseUrl)}; modelo: ${modelLabel(cfg)}${reasoning}.`
}

/**
 * Aplica a ação de voz "ia.raciocinio". Resolve nível absoluto ou relativo e persiste.
 * Devolve um resultado falável; não lança.
 */
function applyReasoningAction(cfg: AppConfig, a: Acao): { resultado?: unknown; erro?: string } {
  if (!providerSupportsReasoning(cfg.nineRouter.baseUrl)) {
    return { erro: `O modelo atual (${modelLabel(cfg)}) não tem ajuste de raciocínio.` }
  }
  const current = coerceReasoning(cfg.nineRouter.reasoning)
  const next = resolveReasoning(current, {
    nivel: a.nivel != null ? String(a.nivel) : undefined,
    direcao: a.direcao != null ? String(a.direcao) : undefined
  })
  if (!next) return { erro: 'Não entendi o nível de raciocínio. Diga baixo, médio, alto, ou aumentar/diminuir.' }
  updateConfig({ nineRouter: { ...cfg.nineRouter, reasoning: next } })
  return {
    resultado: {
      nivelAnterior: REASONING_LABEL[current],
      nivel: REASONING_LABEL[next],
      mudou: next !== current
    }
  }
}

/** Mapeia um nome falado de provedor para o id do preset. */
function matchProviderId(name: string): string | null {
  const n = name.toLowerCase()
  if (/open\s?router|roteador/.test(n)) return 'openrouter'
  if (/deep\s?seek/.test(n)) return 'deepseek'
  if (/chat\s?gpt|gpt|openai|o ?pen ?ai/.test(n)) return 'openai'
  if (/local|9\s?router|nine|caseiro/.test(n)) return 'local'
  return null
}

/** Acha um modelo no preset por correspondência aproximada de nome/valor. */
function matchModelValue(preset: ReturnType<typeof getProvider>, query: string): string | null {
  if (!preset?.models?.length) return null
  const q = query.toLowerCase().trim()
  if (!q) return null
  const norm = (s: string): string => s.toLowerCase()
  // 1) bate por palavra-chave conhecida.
  const wants = (kw: string): boolean => q.includes(kw)
  for (const m of preset.models) {
    const hay = norm(`${m.label} ${m.value}`)
    if (wants('flash') && hay.includes('flash')) return m.value
    if (wants('pro') && hay.includes('pro')) return m.value
    if ((wants('5.5') || wants('gpt')) && (hay.includes('gpt') || hay.includes('5.5'))) return m.value
  }
  // 2) substring direta no rótulo/valor.
  const direct = preset.models.find((m) => norm(`${m.label} ${m.value}`).includes(q))
  return direct?.value || null
}

/**
 * Aplica a ação de voz "ia.modelo": troca provedor e/ou modelo. Persiste e devolve
 * um resultado falável. Ao trocar de provedor sem modelo dito, usa o modelo padrão dele.
 */
function applyModelAction(cfg: AppConfig, a: Acao): { resultado?: unknown; erro?: string } {
  let baseUrl = cfg.nineRouter.baseUrl
  let apiKey = cfg.nineRouter.apiKey
  let model = cfg.nineRouter.model

  const provName = a.provedor != null ? String(a.provedor) : ''
  if (provName) {
    const id = matchProviderId(provName)
    const preset = id ? getProvider(id) : undefined
    if (!preset) return { erro: `Não conheço o provedor "${provName}".` }
    if (preset.baseUrl !== baseUrl) {
      baseUrl = preset.baseUrl
      apiKey = '' // provedor novo: a chave anterior não vale.
      model = preset.defaultModel
    }
  }

  const preset = getProvider(detectProviderId(baseUrl))
  const modelName = a.modelo != null ? String(a.modelo) : ''
  if (modelName) {
    const v = matchModelValue(preset, modelName)
    if (!v) return { erro: `O provedor ${preset?.label || ''} não tem um modelo "${modelName}".` }
    model = v
  }

  if (baseUrl === cfg.nineRouter.baseUrl && model === cfg.nineRouter.model) {
    return { resultado: { provedor: providerLabel(baseUrl), modelo: modelLabel(cfg), mudou: false } }
  }
  const next = { ...cfg.nineRouter, baseUrl, apiKey, model }
  updateConfig({ nineRouter: next })
  const needsLogin = !!getProvider(detectProviderId(baseUrl))?.needsKey && !apiKey
  return {
    resultado: {
      provedor: providerLabel(baseUrl),
      modelo: modelLabel({ ...cfg, nineRouter: next }),
      mudou: true,
      precisaConectar: needsLogin // a UI/fala pode avisar que falta logar/colar chave
    }
  }
}

function buildSystemPrompt(ctx: {
  board: Board
  events: CalendarEvent[]
  location: UserLocation
  codeContext: string
  controlContext: string
  codingPrefs: string
  sessionContext: string
  brain: string
  summary?: string
  voice: boolean
  hasPriorAssistant: boolean
}): string {
  const now = new Date()
  const upcoming = ctx.events
    .filter((e) => new Date(e.whenISO).getTime() > Date.now() - 3600_000)
    .slice(0, 8)
    .map((e) => `- ${new Date(e.whenISO).toLocaleString('pt-BR')}: ${e.title}`)
    .join('\n')
  const loc =
    ctx.location.enabled && typeof ctx.location.latitude === 'number' && typeof ctx.location.longitude === 'number'
      ? `${ctx.location.label || ctx.location.city || 'localização atual'} (aprox.)`
      : ctx.location.city || ctx.location.label
        ? `${ctx.location.label || [ctx.location.city, ctx.location.region].filter(Boolean).join(', ')} (manual)`
      : '(não disponível; use a cidade padrão quando necessário)'
  return [
    PERSONA,
    ctx.voice ? VOICE_HINT : TEXT_HINT,
    ctx.voice ? CODE_VOICE_HINT : '',
    `## Estilo da sessão\n${sessionStyleHint(ctx.hasPriorAssistant)}`,
    toolDocs(),
    `# CONTEXTO`,
    `## DATAS\n${dateAnchors(now)}`,
    `## Localização aproximada do usuário\n${loc}`,
    `## Programação\n${ctx.codeContext}`,
    ctx.codingPrefs ? `## Preferências de código do usuário (respeite-as ao escrever/editar)\n${ctx.codingPrefs}` : '',
    ctx.sessionContext ? `## Memória de sessão (contexto recente de trabalho)\n${ctx.sessionContext}` : '',
    `## Controle do computador\n${ctx.controlContext}`,
    `## Seu cérebro (modelo de IA)\n${ctx.brain}`,
    `## Sobre o usuário (memória de longo prazo)\n${memoryPromptBlock()}`,
    `## Tarefas atuais\n${boardSummary(ctx.board)}`,
    `## Próximos eventos\n${upcoming || '(nenhum)'}`,
    `## Lembretes\n${remindersSummary()}`,
    `## Listas\n${listsSummary()}`,
    ctx.summary ? `## Resumo da conversa anterior\n${ctx.summary}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

// Frases variadas (rotação) para não soar robótico repetindo sempre o mesmo aviso.
const LONG_TASK_ANNOUNCES = [
  ' Iniciando a tarefa, senhor. Um momento.',
  ' Certo, executando agora. Isso pode levar um instante.',
  ' Em andamento. Aviso assim que terminar.'
]
let announceIdx = 0

/**
 * Avisa em voz "iniciando a tarefa" ANTES de bloquear num comando de longa duração
 * (build/install/test), para não deixar o usuário no vácuo. Só fala quando o comando
 * realmente vai rodar (já autorizado ou seguro) — nunca antes de pedir o "sim".
 * `phase` deve ser a fase de streaming ATUAL (com o loop de rodadas, não é sempre 1).
 */
function announceLongTask(onDelta: DeltaFn | undefined, cfg: AppConfig, command: string, willRun: boolean, phase: number): void {
  if (!onDelta || !willRun || !isLongRunningCommand(command)) return
  onDelta(LONG_TASK_ANNOUNCES[announceIdx++ % LONG_TASK_ANNOUNCES.length], phase)
}


/**
 * Coleta o material bruto que cada especialista da Colmeia precisa ANTES da
 * chamada de LLM: o Investigador recebe busca web (e a página, se houver URL),
 * o Construtor recebe o resumo do workspace e o Crítico o diagnóstico do projeto.
 * Falhas de coleta não derrubam a tarefa — o subagente trabalha com o que houver.
 */
async function gatherSubagentEvidence(
  profile: SubagentProfile,
  a: Acao,
  cfg: AppConfig,
  goal: string,
  signal?: AbortSignal,
  progress?: (event: { stream: 'stdout' | 'stderr'; chunk: string }) => void
): Promise<string | undefined> {
  const root = String(a.path || a.raiz || a.workspace || '')
  try {
    if (profile.id === 'researcher') {
      const parts: string[] = []
      const results = await webSearch(String(a.consulta || goal))
      if (Array.isArray(results) && results.length) {
        parts.push('Resultados de busca:\n' + results.map((r) => `- ${r.title} (${r.url}): ${r.snippet}`).join('\n'))
      }
      const url = String(a.url || a.endereco || '').trim()
      if (url) {
        const page = await readPage(url)
        parts.push(`Conteúdo da página ${url}:\n${JSON.stringify(page).slice(0, 4000)}`)
      }
      return parts.join('\n\n') || undefined
    }
    if (!cfg.integrations.code.enabled) return undefined
    if (profile.id === 'engineer') {
      const ws = summarizeCodeWorkspace(cfg, root)
      return `Workspace ${ws.name} (${ws.root}):\nlinguagens: ${JSON.stringify(ws.languages)}\nscripts: ${JSON.stringify(ws.scripts || {})}\narquivos:\n${ws.files.slice(0, 80).join('\n')}\n${ws.hints.join('\n')}`
    }
    // auditor: roda o diagnóstico real (typecheck/lint/test disponíveis) como material.
    const diag = await diagnoseProject(cfg, { root, signal, onProgress: progress })
    const checks = diag.checks.map((c) => `- ${c.name} (${c.command}): ${c.ran ? c.summary : 'não rodou'}`).join('\n')
    return `Diagnóstico de ${diag.name} (${diag.root}) — ${diag.health.label}:\n${checks}\n${diag.hints.join('\n')}`
  } catch (e) {
    return `Falha ao coletar material: ${e instanceof Error ? e.message : String(e)}`
  }
}

async function runQuery(
  a: Acao,
  cfg: AppConfig,
  sessionId: string,
  onDelta?: DeltaFn,
  signal?: AbortSignal,
  onActivity?: ActivityFn,
  phase = 1,
  onHive?: HiveStatusFn
): Promise<unknown> {
  const integrations = cfg.integrations
  const activity = codeActivityMeta(a)
  const progress = createProgressActivity(onActivity, activity)
  // Tarefas potencialmente longas falam um "batimento" periódico enquanto rodam.
  const beating = async <T>(work: Promise<T>): Promise<T> => {
    const stop = startHeartbeat(onDelta, phase)
    try {
      return await work
    } finally {
      stop()
    }
  }
  const done = <T>(result: T): T => {
    const r = result as { resultado?: Record<string, unknown>; erro?: string }
    if (r.erro) emitActivity(onActivity, activity, { status: 'error', detail: r.erro, ok: false })
    else if (r.resultado?.requiresApproval === true) {
      emitActivity(onActivity, activity, {
        status: 'waiting',
        detail: String(r.resultado.reason || 'aguardando autorização'),
        command: typeof r.resultado.command === 'string' ? r.resultado.command : activity?.command,
        ok: false
      })
    } else {
      emitActivity(onActivity, activity, { status: 'done', detail: activityDetail(result), ok: activityOk(result) })
    }
    return result
  }
  emitActivity(onActivity, activity, { status: 'running' })
  try {
    switch (a.tipo) {
      case 'clima.consultar': {
        const city = String(a.cidade || '').trim()
        const resultado = city
          ? await getWeather(city)
          : integrations.location.enabled && typeof integrations.location.latitude === 'number'
            ? await getWeatherAt(integrations.location)
            : await getWeather(integrations.weatherCity)
        return { tipo: a.tipo, resultado }
      }
      case 'web.buscar':
        return { tipo: a.tipo, resultado: await webSearch(String(a.consulta || a.query || '')) }
      case 'noticias.listar':
        return { tipo: a.tipo, resultado: await getNews(String(a.tema || integrations.newsTopic || '')) }
      case 'agenda.listar': {
        const dia = a.dia ? String(a.dia).slice(0, 10) : null
        const evs = loadEvents().filter((e) => (dia ? e.whenISO.slice(0, 10) === dia : true))
        return { tipo: a.tipo, resultado: evs.map((e) => ({ titulo: e.title, quando: e.whenISO, descricao: e.description })) }
      }
      case 'tarefa.listar':
        return { tipo: a.tipo, resultado: boardSummary(loadBoard()) }
      case 'calcular':
        return { tipo: a.tipo, resultado: calcExpression(String(a.expressao || a.conta || '')) }
      case 'converter.moeda':
        return {
          tipo: a.tipo,
          resultado: await convertCurrency(String(a.de || ''), String(a.para || ''), Number(a.valor))
        }
      case 'converter.unidade':
        return {
          tipo: a.tipo,
          resultado: convertUnit(String(a.de || ''), String(a.para || ''), Number(a.valor))
        }
      case 'pagina.ler':
        return { tipo: a.tipo, resultado: await readPage(String(a.url || a.endereco || a.link || '')) }
      case 'sistema.status':
        return { tipo: a.tipo, resultado: getSystemMetrics() }
      case 'area.ler': {
        const c = readClipboard()
        return c.vazio ? { tipo: a.tipo, erro: 'A área de transferência está vazia.' } : { tipo: a.tipo, resultado: c }
      }
      case 'area.escrever':
        return { tipo: a.tipo, resultado: writeClipboard(String(a.texto || a.text || a.conteudo || a.content || '')) }
      case 'sistema.abrir':
        return {
          tipo: a.tipo,
          resultado: runOpen(cfg, String(a.alvo || a.target || a.app || a.aplicativo || a.url || a.programa || ''))
        }
      case 'sistema.volume': {
        const level = Number(a.nivel ?? a.level ?? a.valor ?? a.percentual)
        const action = normVolumeAction(a.acao ?? a.action ?? a.direcao)
        if (action === 'set' && !Number.isFinite(level)) {
          return { tipo: a.tipo, erro: 'Diga o nível (0 a 100) ou se é para aumentar, diminuir ou mutar.' }
        }
        return { tipo: a.tipo, resultado: runVolume(cfg, { action, level }) }
      }
      case 'sistema.bloquear':
        return { tipo: a.tipo, resultado: runLock(cfg) }
      case 'sistema.captura':
        return { tipo: a.tipo, resultado: runScreenshot(cfg) }
      case 'sistema.midia':
        return { tipo: a.tipo, resultado: runMedia(cfg, normMediaAction(a.acao ?? a.action ?? a.comando)) }
      case 'sistema.brilho': {
        const level = Number(a.nivel ?? a.level ?? a.valor ?? a.percentual)
        const action = normBrightnessAction(a.acao ?? a.action ?? a.direcao)
        if (action === 'set' && !Number.isFinite(level)) {
          return { tipo: a.tipo, erro: 'Diga o nível do brilho (0 a 100) ou se é para clarear ou escurecer.' }
        }
        return { tipo: a.tipo, resultado: runBrightness(cfg, { action, level }) }
      }
      case 'ia.raciocinio': {
        const r = applyReasoningAction(cfg, a)
        return r.erro ? { tipo: a.tipo, erro: r.erro } : { tipo: a.tipo, resultado: r.resultado }
      }
      case 'ia.modelo': {
        const r = applyModelAction(cfg, a)
        return r.erro ? { tipo: a.tipo, erro: r.erro } : { tipo: a.tipo, resultado: r.resultado }
      }
      case 'desfazer': {
        const r = undoLast(userDataDir())
        return r.ok
          ? { tipo: a.tipo, resultado: { ok: true, desfeito: r.label || 'a última alteração' } }
          : { tipo: a.tipo, erro: 'Não há nada para desfazer.' }
      }
      case 'memoria.buscar':
        return {
          tipo: a.tipo,
          resultado: searchSessions(String(a.consulta || a.query || a.texto || ''), Number(a.limite || a.limit || 5))
        }
      case 'codigo.workspace':
        return done({ tipo: a.tipo, resultado: summarizeCodeWorkspace(cfg, String(a.path || a.raiz || a.workspace || '')) })
      case 'codigo.buscar':
        return done({
          tipo: a.tipo,
          resultado: searchCode(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            query: String(a.consulta || a.query || a.simbolo || ''),
            filter: a.filtro ? String(a.filtro) : a.glob ? String(a.glob) : undefined,
            maxResults: Number(a.limite || a.max || 0) || undefined
          })
        })
      case 'codigo.ler':
        return done({
          tipo: a.tipo,
          resultado: readCodeFile(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            file: String(a.arquivo || a.file || ''),
            startLine: Number(a.inicio || a.start || 0) || undefined,
            lines: Number(a.linhas || a.lines || 0) || undefined
          })
        })
      case 'codigo.comando':
        return done({
          tipo: a.tipo,
          resultado: await beating(runCodeCommand(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            command: String(a.comando || a.command || ''),
            signal,
            onProgress: progress
          }))
        })
      case 'codigo.terminal': {
        const root = String(a.path || a.raiz || a.workspace || '')
        const command = String(a.comando || a.command || '')
        const approved = a.confirmado === true || a.autorizado === true || a.confirm === true || a.approved === true
        // Só anuncia se o comando for de fato rodar agora (autorizado ou já seguro).
        announceLongTask(onDelta, cfg, command, approved || classifyCommand(cfg, command).tier === 'allowed', phase)
        const result = await beating(runCodeTerminal(cfg, { root, command, approved, signal, onProgress: progress }))
        if (result.requiresApproval) {
          setPendingCode(sessionId, { kind: 'terminal', command: result.command, root, reason: result.reason })
        } else if (result.ran) {
          clearPendingCode(sessionId)
          if (result.ok) setLastTerminalCommand(result.command, result.root)
        }
        return done({ tipo: a.tipo, resultado: result })
      }
      case 'codigo.confirmar': {
        const pend = getPendingCode(sessionId)
        if (!pend) return done({ tipo: a.tipo, erro: 'Não há nenhum comando pendente de autorização.' })
        if (activity && !activity.command) activity.command = pend.command
        announceLongTask(onDelta, cfg, pend.command, true, phase)
        const result = await beating(runCodeTerminal(cfg, { root: pend.root, command: pend.command, approved: true, signal, onProgress: progress }))
        if (result.ran) {
          clearPendingCode(sessionId)
          if (result.ok) setLastTerminalCommand(result.command, result.root)
        }
        return done({ tipo: a.tipo, resultado: result })
      }
      case 'codigo.cancelar': {
        const had = !!getPendingCode(sessionId)
        clearPendingCode(sessionId)
        return done({ tipo: a.tipo, resultado: { cancelado: had, mensagem: had ? 'comando pendente descartado' : 'nada pendente' } })
      }
      case 'codigo.git':
        return done({
          tipo: a.tipo,
          resultado: await runCodeGit(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            operation: String(a.operacao || a.operation || 'status'),
            file: a.arquivo || a.file ? String(a.arquivo || a.file) : undefined,
            signal,
            onProgress: progress
          })
        })
      case 'codigo.indexar':
        return done({
          tipo: a.tipo,
          resultado: buildCodeIndex(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            refresh: a.refresh === true || a.atualizar === true
          })
        })
      case 'codigo.scaffold': {
        const resultado = scaffoldProject(cfg, {
          tipo: String(a.tipo_projeto || a.template || a.modelo || a.kind || 'site'),
          nome: String(a.nome || a.name || a.projeto || ''),
          path: String(a.path || a.raiz || a.destino || a.onde || ''),
          force: a.force === true || a.forcar === true
        })
        if (resultado.created[0]) setLastEditedFile(resultado.created[0], resultado.root)
        return done({ tipo: a.tipo, resultado })
      }
      case 'codigo.criar': {
        const resultado = writeCodeFile(cfg, {
          root: String(a.path || a.raiz || a.workspace || ''),
          file: String(a.arquivo || a.file || ''),
          content: String(a.conteudo ?? a.content ?? a.texto ?? ''),
          overwrite: a.sobrescrever === true || a.overwrite === true
        })
        setLastEditedFile(resultado.file, String(a.path || a.raiz || a.workspace || '') || undefined)
        return done({ tipo: a.tipo, resultado })
      }
      case 'codigo.editar': {
        const mode = String(a.modo || a.mode || '') as CodeEditMode
        const resultado = editCodeFile(cfg, {
          root: String(a.path || a.raiz || a.workspace || ''),
          file: String(a.arquivo || a.file || ''),
          mode,
          oldText: a.antigo || a.oldText || a.find ? String(a.antigo || a.oldText || a.find) : undefined,
          newText: String(a.novo ?? a.newText ?? a.replace ?? ''),
          anchor: a.ancora || a.anchor ? String(a.ancora || a.anchor) : undefined,
          startLine: Number(a.inicio || a.startLine || a.start || 0) || undefined,
          endLine: Number(a.fim || a.endLine || a.end || 0) || undefined,
          replaceAll: a.todos === true || a.replaceAll === true || a.all === true,
          expectedMatches: Number.isFinite(Number(a.esperado ?? a.expectedMatches))
            ? Number(a.esperado ?? a.expectedMatches)
            : undefined
        })
        setLastEditedFile(resultado.file, String(a.path || a.raiz || a.workspace || '') || undefined)
        return done({ tipo: a.tipo, resultado })
      }
      case 'codigo.diagnostico':
        return done({
          tipo: a.tipo,
          resultado: await beating(diagnoseProject(cfg, { root: String(a.path || a.raiz || a.workspace || ''), signal, onProgress: progress }))
        })
      case 'codigo.testar':
        return done({ tipo: a.tipo, resultado: await beating(runTests(cfg, { root: String(a.path || a.raiz || a.workspace || ''), signal, onProgress: progress })) })
      case 'codigo.lint':
        return done({ tipo: a.tipo, resultado: await beating(runLint(cfg, { root: String(a.path || a.raiz || a.workspace || ''), signal, onProgress: progress })) })
      case 'codigo.formatar':
        return done({ tipo: a.tipo, resultado: await beating(runFormat(cfg, { root: String(a.path || a.raiz || a.workspace || ''), signal, onProgress: progress })) })
      case 'codigo.typecheck':
        return done({ tipo: a.tipo, resultado: await beating(runTypecheck(cfg, { root: String(a.path || a.raiz || a.workspace || ''), signal, onProgress: progress })) })
      case 'codigo.deps':
        return done({ tipo: a.tipo, resultado: await beating(checkDependencies(cfg, { root: String(a.path || a.raiz || a.workspace || ''), signal, onProgress: progress })) })
      case 'codigo.todo':
        return done({
          tipo: a.tipo,
          resultado: scanTodos(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            filter: a.filtro || a.filter ? String(a.filtro || a.filter) : undefined,
            maxResults: Number(a.limite || a.max || 0) || undefined
          })
        })
      case 'codigo.projeto':
        return done({
          tipo: a.tipo,
          resultado: await beating(runCoderTask(cfg, {
            objetivo: String(a.objetivo || a.tarefa || a.descricao || a.texto || ''),
            root: String(a.path || a.raiz || a.destino || a.onde || a.nome || ''),
            passos: Number(a.passos || a.steps || 0) || undefined,
            signal
          }))
        })
      case 'codigo.listar':
        return done({
          tipo: a.tipo,
          resultado: listCodeFiles(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            pattern: String(a.padrao || a.pattern || a.filtro || a.glob || ''),
            maxResults: Number(a.limite || a.max || 0) || undefined
          })
        })
      case 'codigo.esboco':
        return done({
          tipo: a.tipo,
          resultado: outlineCodeFile(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            file: String(a.arquivo || a.file || '')
          })
        })
      case 'codigo.referencias':
        return done({
          tipo: a.tipo,
          resultado: findCodeReferences(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            symbol: String(a.simbolo || a.symbol || a.nome || a.consulta || ''),
            maxResults: Number(a.limite || a.max || 0) || undefined
          })
        })
      case 'codigo.substituir': {
        const apply = a.confirmado === true || a.aplicar === true || a.apply === true
        const resultado = replaceInProject(cfg, {
          root: String(a.path || a.raiz || a.workspace || ''),
          find: String(a.de ?? a.find ?? a.antigo ?? ''),
          replace: String(a.para ?? a.replace ?? a.novo ?? ''),
          filter: a.filtro || a.filter ? String(a.filtro || a.filter) : undefined,
          apply
        })
        if (resultado.applied && resultado.files[0]) setLastEditedFile(resultado.files[0].file, resultado.root)
        return done({ tipo: a.tipo, resultado })
      }
      case 'codigo.patch.preview':
        return done({
          tipo: a.tipo,
          resultado: previewCodePatch(cfg, {
            root: String(a.path || a.raiz || a.workspace || ''),
            diff: a.diff,
            patches: a.patches
          })
        })
      case 'codigo.patch.aplicar': {
        const resultado = applyCodePatch(cfg, {
          root: String(a.path || a.raiz || a.workspace || ''),
          diff: a.diff,
          patches: a.patches
        })
        if (resultado.applied && resultado.files[0]) setLastEditedFile(resultado.files[0], resultado.root)
        return done({ tipo: a.tipo, resultado })
      }
      case 'subagente.pesquisar':
      case 'subagente.construir':
      case 'subagente.auditar': {
        const profile: SubagentProfile =
          a.tipo === 'subagente.pesquisar' ? RESEARCHER : a.tipo === 'subagente.construir' ? ENGINEER : AUDITOR
        const goal = String(a.objetivo || a.tarefa || a.consulta || a.texto || '').trim()
        if (!goal) return done({ tipo: a.tipo, erro: 'Diga o objetivo da tarefa para o subagente.' })
        const r = await beating(
          (async () => {
            const task: SubagentTask = {
              goal,
              context: a.contexto ? String(a.contexto) : undefined,
              evidence: await gatherSubagentEvidence(profile, a, cfg, goal, signal, progress),
              memories: relevantMemories(goal, loadMemory())
            }
            return executeSubagentTask(profile, task, cfg, onHive, signal)
          })()
        )
        return done({
          tipo: a.tipo,
          resultado: {
            agente: r.label,
            ok: r.ok,
            duracaoMs: r.durationMs,
            summary: `${r.label}: relatório ${r.ok ? 'entregue' : 'com falha'} em ${Math.round(r.durationMs / 1000)}s`,
            relatorio: r.report
          }
        })
      }
      case 'briefing.consultar': {
        const b = await buildBriefing(cfg)
        return {
          tipo: a.tipo,
          resultado: {
            data: b.dateLabel,
            clima: b.weather
              ? { local: b.weather.city, temp: b.weather.current.temp, desc: b.weather.current.desc, alerta: b.weather.alert }
              : b.weatherError || 'indisponível',
            eventosHoje: b.todayEvents.map((e) => ({ titulo: e.title, quando: e.whenISO })),
            tarefasVencidas: b.overdueTasks.map((t) => t.title),
            proximasTarefas: b.upcomingTasks.map((t) => t.title),
            lembretes: b.reminders.map((r) => r.title),
            noticias: b.news.map((n) => n.title),
            sugestoes: b.suggestions
          }
        }
      }
    }
  } catch (e) {
    return done({ tipo: a.tipo, erro: e instanceof Error ? e.message : String(e) })
  }
  return { tipo: a.tipo, erro: 'ferramenta desconhecida' }
}

/**
 * Após um patch/criação de arquivo bem-sucedido, monta uma sugestão proativa de
 * validação (rodar o teste/build detectado no package.json). Retorna a instrução para
 * o LLM oferecer isso na fala e uma nota curta para o toast. Null se não se aplicar.
 */
function proactiveCodeFollowup(
  cfg: AppConfig,
  results: unknown[]
): { instruction: string; note: string } | null {
  const ok = results.find((r) => {
    const o = r as { tipo?: string; resultado?: { applied?: boolean; created?: unknown[] } }
    if (o?.tipo === 'codigo.patch.aplicar') return o.resultado?.applied === true
    if (o?.tipo === 'codigo.criar') return true
    if (o?.tipo === 'codigo.scaffold') return Array.isArray(o.resultado?.created) && o.resultado!.created!.length > 0
    return false
  }) as { resultado?: { root?: string } } | undefined
  if (!ok) return null
  try {
    const summary = summarizeCodeWorkspace(cfg, ok.resultado?.root || '')
    const command = proactiveValidationCommand(summary.scripts, summary.packageManager || 'npm')
    if (!command) return null
    return {
      instruction: `PROATIVIDADE: a alteração foi aplicada. Ofereça rodar "${command}" para validar (uma frase curta) e, se o usuário aceitar, use codigo.comando/codigo.terminal.`,
      note: `sugestão: validar com ${command}`
    }
  } catch {
    return null
  }
}

function applyMutations(acoes: Acao[]): { board: Board; notes: string[]; changedBoard: boolean } {
  let board = loadBoard()
  const original = board
  const notes: string[] = []
  for (const a of acoes) {
    if (a.tipo.startsWith('tarefa.') || a.tipo.startsWith('coluna.')) {
      const r = applyBoardAction(board, a)
      board = r.board
      if (r.note) notes.push(r.note)
    } else if (a.tipo === 'memoria.salvar' && a.fato) {
      addFact(String(a.fato), {
        category: asCategory(a.categoria),
        source: 'manual',
        status: 'active',
        evidence: a.evidencia ? [String(a.evidencia)] : undefined
      })
      notes.push('memória atualizada')
    } else if (a.tipo === 'memoria.remover' && a.fato) {
      const f = loadMemory().find((x) => norm(x.text).includes(norm(a.fato)))
      if (f) removeFact(f.id)
    } else if (a.tipo === 'evento.criar' && a.titulo && a.quando) {
      addEvent({
        title: String(a.titulo),
        whenISO: String(a.quando),
        description: a.descricao ? String(a.descricao) : undefined,
        remindMinutes: typeof a.lembreteMin === 'number' ? a.lembreteMin : Number(a.lembreteMin) || undefined,
        recurrence: a.repetir as CalendarEvent['recurrence']
      })
      notes.push('evento criado')
    } else if (a.tipo === 'evento.remover' && a.titulo) {
      const e = loadEvents().find((x) => norm(x.title).includes(norm(a.titulo)))
      if (e) removeEvent(e.id)
    } else if (a.tipo === 'lista.criar' && a.titulo) {
      listCreate(String(a.titulo))
      notes.push(`lista "${a.titulo}" criada`)
    } else if (a.tipo === 'lista.adicionar' && a.item) {
      listAddItem(String(a.lista || 'Compras'), String(a.item))
      notes.push(`+ "${a.item}" na lista`)
    } else if (a.tipo === 'lista.marcar' && a.item) {
      listToggleItem(String(a.lista || ''), String(a.item), typeof a.feito === 'boolean' ? a.feito : undefined)
      notes.push(`✓ "${a.item}"`)
    } else if (a.tipo === 'lista.removerItem' && a.item) {
      listRemoveItem(String(a.lista || ''), String(a.item))
      notes.push(`🗑 "${a.item}"`)
    } else if (a.tipo === 'lista.limpar' && a.lista) {
      listClear(String(a.lista))
      notes.push(`lista "${a.lista}" limpa`)
    } else if (a.tipo === 'nota.salvar' && a.texto) {
      addNote(String(a.texto))
      notes.push('nota salva')
    } else if (a.tipo === 'lembrete.criar' && a.texto) {
      const mins = Number(a.emMinutos)
      const whenISO =
        Number.isFinite(mins) && mins > 0
          ? new Date(Date.now() + mins * 60_000).toISOString()
          : String(a.quando || new Date(Date.now() + 60_000).toISOString())
      const modo = String(a.modo || '')
      addReminder({
        text: String(a.texto),
        whenISO,
        recurrence: a.repetir as CalendarEvent['recurrence'],
        kind: (['timer', 'alarm', 'reminder'].includes(modo) ? modo : 'reminder') as 'reminder' | 'timer' | 'alarm'
      })
      notes.push('lembrete criado')
    } else if (a.tipo === 'lembrete.remover' && a.texto) {
      removeReminderByText(String(a.texto))
      notes.push('lembrete removido')
    }
  }
  const changedBoard = board !== original
  if (changedBoard) saveBoard(board)
  return { board, notes, changedBoard }
}

function memoryFallback(userText: string, acoes: Acao[]): Acao[] {
  if (acoes.some((a) => a.tipo === 'memoria.salvar')) return acoes
  const match =
    userText.match(/(?:lembre-se que|lembra que|memorize que|guarde que|anote que)\s+(.+)/i) ||
    userText.match(/(?:minha preferência é|eu prefiro|prefiro)\s+(.+)/i)
  const fact = match?.[1]?.replace(/[.!?]+$/, '').trim()
  return fact ? [...acoes, { tipo: 'memoria.salvar', fato: fact }] : acoes
}

// Canal do delta: 'both' (exibe no chat E fala — padrão), 'display' (só texto na tela,
// não fala — usado para streamar a resposta COMPLETA de código) ou 'speak' (só fala, não
// altera a tela — usado para o resumo falável conciso de tarefas de programação).
export type DeltaKind = 'both' | 'display' | 'speak'
export type DeltaFn = (chunk: string, phase: number, kind?: DeltaKind) => void
export type ActivityFn = (activity: AgentActivityEvent) => void
export type { HiveStatusFn }
type DeltaTextTransform = (text: string, phase: number, kind: DeltaKind) => string

type ActivityMeta = {
  id: string
  kind: AgentActivityKind
  title: string
  detail?: string
  target?: string
  command?: string
}

function trimActivityOutput(raw: string): string {
  return String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(-4)
    .join('\n')
    .slice(-900)
}

function emitActivity(
  onActivity: ActivityFn | undefined,
  meta: ActivityMeta | null,
  patch: Omit<AgentActivityEvent, 'id' | 'kind' | 'title' | 'phase' | 'ts'>
): void {
  if (!onActivity || !meta) return
  onActivity({
    id: meta.id,
    kind: meta.kind,
    title: meta.title,
    phase: 1,
    ts: Date.now(),
    detail: meta.detail,
    target: meta.target,
    command: meta.command,
    ...patch
  })
}

function codeActivityMeta(a: Acao): ActivityMeta | null {
  const tipo = String(a.tipo || '')
  if (tipo.startsWith('subagente.')) {
    const goal = String(a.objetivo || a.tarefa || a.consulta || '').slice(0, 120) || undefined
    const title =
      tipo === 'subagente.pesquisar'
        ? 'Investigador pesquisando'
        : tipo === 'subagente.construir'
          ? 'Construtor projetando'
          : 'Crítico auditando'
    return { id: uid('act'), kind: 'hive', title, detail: goal }
  }
  if (!tipo.startsWith('codigo.')) return null
  const path = String(a.path || a.raiz || a.workspace || a.destino || a.onde || '').trim()
  const file = String(a.arquivo || a.file || '').trim()
  const command = String(a.comando || a.command || '').trim()
  const query = String(a.consulta || a.query || a.simbolo || '').trim()
  const target = file || path || undefined
  const base = { id: uid('act'), target }
  switch (tipo) {
    case 'codigo.workspace':
      return { ...base, kind: 'workspace', title: 'Analisando workspace', detail: path || undefined }
    case 'codigo.buscar':
      return { ...base, kind: 'search', title: 'Buscando no código', detail: query || undefined }
    case 'codigo.listar':
      return { ...base, kind: 'search', title: 'Listando arquivos', detail: String(a.padrao || a.pattern || a.filtro || '') || undefined }
    case 'codigo.esboco':
      return { ...base, kind: 'read', title: 'Mapeando arquivo', detail: file || undefined }
    case 'codigo.referencias':
      return { ...base, kind: 'search', title: 'Procurando referências', detail: String(a.simbolo || a.symbol || a.nome || '') || undefined }
    case 'codigo.substituir':
      return {
        ...base,
        kind: 'write',
        title: a.confirmado === true || a.aplicar === true ? 'Substituindo no projeto' : 'Prévia de substituição',
        detail: `${String(a.de ?? a.find ?? a.antigo ?? '')} -> ${String(a.para ?? a.replace ?? a.novo ?? '')}`.slice(0, 120)
      }
    case 'codigo.ler':
      return { ...base, kind: 'read', title: 'Lendo arquivo', detail: file || undefined }
    case 'codigo.comando':
      return { ...base, kind: 'command', title: 'Rodando comando', command }
    case 'codigo.terminal':
      return { ...base, kind: 'terminal', title: 'Terminal', command }
    case 'codigo.confirmar':
      return { ...base, kind: 'terminal', title: 'Executando comando autorizado' }
    case 'codigo.cancelar':
      return { ...base, kind: 'terminal', title: 'Cancelando comando pendente' }
    case 'codigo.git':
      return { ...base, kind: 'git', title: 'Consultando Git', detail: String(a.operacao || a.operation || 'status') }
    case 'codigo.indexar':
      return { ...base, kind: 'index', title: 'Indexando projeto', detail: path || undefined }
    case 'codigo.scaffold':
      return { ...base, kind: 'scaffold', title: 'Criando projeto', detail: String(a.nome || a.name || a.projeto || '') || undefined }
    case 'codigo.criar':
      return { ...base, kind: 'write', title: 'Escrevendo arquivo', detail: file || undefined }
    case 'codigo.editar':
      return { ...base, kind: 'write', title: 'Editando arquivo', detail: file || undefined }
    case 'codigo.diagnostico':
      return { ...base, kind: 'diagnostic', title: 'Rodando diagnóstico', detail: path || undefined }
    case 'codigo.testar':
      return { ...base, kind: 'command', title: 'Rodando testes', detail: path || undefined }
    case 'codigo.lint':
      return { ...base, kind: 'command', title: 'Rodando lint', detail: path || undefined }
    case 'codigo.formatar':
      return { ...base, kind: 'command', title: 'Formatando projeto', detail: path || undefined }
    case 'codigo.typecheck':
      return { ...base, kind: 'command', title: 'Checando tipos', detail: path || undefined }
    case 'codigo.deps':
      return { ...base, kind: 'command', title: 'Checando dependências', detail: path || undefined }
    case 'codigo.todo':
      return { ...base, kind: 'search', title: 'Procurando pendências', detail: path || undefined }
    case 'codigo.projeto':
      return { ...base, kind: 'write', title: 'Executando coder autônomo', detail: String(a.objetivo || a.tarefa || '') || undefined }
    case 'codigo.patch.preview':
      return { ...base, kind: 'patch', title: 'Validando patch', detail: path || undefined }
    case 'codigo.patch.aplicar':
      return { ...base, kind: 'patch', title: 'Aplicando patch', detail: path || undefined }
    default:
      return { ...base, kind: 'tool', title: tipo.replace('codigo.', 'Código: ') }
  }
}

function activityDetail(result: unknown): string | undefined {
  const r = result as { resultado?: Record<string, unknown>; erro?: string }
  if (r.erro) return r.erro
  const o = r.resultado || {}
  if (typeof o.summary === 'string' && o.summary) return o.summary
  if (typeof o.file === 'string') return o.file
  if (Array.isArray(o.files) && o.files.length) return `${o.files.length} arquivo(s)`
  if (Array.isArray(o.created) && o.created.length) return `${o.created.length} arquivo(s) criados`
  if (typeof o.command === 'string' && Object.prototype.hasOwnProperty.call(o, 'code')) return `código ${String(o.code)}`
  if (typeof o.root === 'string') return o.root
  return undefined
}

function activityOk(result: unknown): boolean | undefined {
  const r = result as { resultado?: Record<string, unknown>; erro?: string }
  if (r.erro) return false
  const o = r.resultado || {}
  if (typeof o.ok === 'boolean') return o.ok
  if (typeof o.applied === 'boolean') return o.applied
  if (typeof o.ran === 'boolean' && typeof o.requiresApproval === 'boolean') return o.ran ? o.ok === true : undefined
  return true
}

function createProgressActivity(onActivity: ActivityFn | undefined, meta: ActivityMeta | null): (event: { stream: 'stdout' | 'stderr'; chunk: string }) => void {
  let last = 0
  return ({ stream, chunk }) => {
    const output = trimActivityOutput(chunk)
    if (!output) return
    const now = Date.now()
    if (now - last < 250 && !chunk.includes('\n')) return
    last = now
    emitActivity(onActivity, meta, { status: 'output', stream, output })
  }
}

/**
 * Faz uma chamada do agente transmitindo a "fala" em tempo real (streaming) via
 * onDelta. Sem consumidor de streaming, cai na chamada JSON robusta. Em falha de
 * stream sem nada emitido, faz fallback para chatJSON.
 */
async function streamTurn(
  cfg: AppConfig,
  messages: ChatMessage[],
  phase: number,
  onDelta?: DeltaFn,
  kind: DeltaKind = 'both',
  transform?: DeltaTextTransform,
  signal?: AbortSignal
): Promise<string> {
  if (!onDelta) return chatJSON(cfg, messages, true)
  let cumulative = ''
  let emitted = 0
  const pump = (full: string): void => {
    const { text } = extractFalaPrefix(full)
    const out = transform ? transform(text, phase, kind) : text
    if (out.length > emitted) {
      onDelta(out.slice(emitted), phase, kind)
      emitted = out.length
    }
  }
  try {
    const full = await streamChat(cfg, messages, (delta) => {
      cumulative += delta
      pump(cumulative)
    }, signal)
    pump(full)
    return full
  } catch (e) {
    if (emitted > 0) throw e // já falamos parte: não dá para refazer com segurança
    const full = await chatJSON(cfg, messages, true)
    const env = parseEnvelope(full)
    if (env.fala) onDelta(transform ? transform(env.fala, phase, kind) : env.fala, phase, kind)
    return full
  }
}

/** Separa as ações válidas das inválidas, com notas para o usuário. */
function validateActions(acoes: Acao[]): { valid: Acao[]; notes: string[] } {
  const valid: Acao[] = []
  const notes: string[] = []
  for (const a of acoes) {
    const v = validateAction(a)
    if (v.ok) valid.push(a)
    else notes.push(`ação ignorada (${v.error})`)
  }
  return { valid, notes }
}

// Máximo de rodadas de ferramentas encadeadas por turno (buscar -> ler -> validar...).
const MAX_TOOL_ROUNDS = 3

/** Executa um turno completo de conversa + ações, com fala transmitida em streaming. */
export async function runTurn(
  sessionId: string,
  userText: string,
  voice = false,
  onDelta?: DeltaFn,
  onActivity?: ActivityFn,
  onHive?: HiveStatusFn
): Promise<AgentTurnResult> {
  const cfg = readConfig()
  // Controlador de cancelamento do turno: permite ao usuário (Esc/IPC code:cancel) abortar
  // um comando/coder em execução sem travar o app. Registrado por sessão.
  const controller = new AbortController()
  const unregisterRun = registerRun(sessionId, controller)
  const signal = controller.signal
  const session = getSession(sessionId)
  // 16 mensagens recentes (era 12): melhora a continuidade de referências ("ele",
  // "aquele arquivo") sem pesar — o resumo automático cobre o histórico mais antigo.
  const recent = (session?.messages || []).slice(-16)
  const hasPriorAssistant = recent.some((m) => m.role === 'assistant')
  const suppressGreeting = hasPriorAssistant
  const deltaTransform: DeltaTextTransform | undefined = suppressGreeting
    ? (text) => stripRepeatedGreeting(text)
    : undefined
  const sys = buildSystemPrompt({
    board: loadBoard(),
    events: loadEvents(),
    location: cfg.integrations.location,
    codeContext: codePromptContext(cfg),
    controlContext: controlPromptContext(cfg),
    codingPrefs: codingPreferencesSummary(),
    sessionContext: sessionContextSummary(),
    brain: brainSummary(cfg),
    summary: session?.summary,
    voice,
    hasPriorAssistant
  })
  const messages: ChatMessage[] = [
    { role: 'system', content: sys },
    ...recent.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
    { role: 'user', content: voiceAwareUserContent(userText, voice) }
  ]

  const env = parseEnvelope(await streamTurn(cfg, messages, 1, onDelta, 'both', deltaTransform, signal))
  let fala = finalFala(env.fala, suppressGreeting)
  let falaVoz: string | undefined
  const allNotes: string[] = []
  let mutations = env.acoes.filter((a) => !QUERY_TOOLS.has(a.tipo))
  let queries = env.acoes.filter((a) => QUERY_TOOLS.has(a.tipo))

  // Loop agêntico: o LLM pode ENCADEAR rodadas de ferramentas (buscar -> ler ->
  // editar -> validar) num único turno. Cada rodada roda as consultas em PARALELO
  // (Promise.all preserva a ordem), devolve os resultados e abre uma nova fase de
  // streaming (fase nova = reset no cliente). Limitado a MAX_TOOL_ROUNDS para
  // nunca entrar em ciclo; na última rodada o LLM é instruído a concluir.
  let convo: ChatMessage[] = messages
  let phase = 1
  for (let round = 0; queries.length && round < MAX_TOOL_ROUNDS; round++) {
    const results = await Promise.all(
      queries.map((q) => runQuery(q, cfg, sessionId, onDelta, signal, onActivity, phase, onHive))
    )
    const codeMode = hasCodeAction(queries)
    // Proatividade de engenheiro: após editar com sucesso, oferece validar (teste/build).
    const proactive = proactiveCodeFollowup(cfg, results)
    if (proactive) allNotes.push(proactive.note)
    const lastRound = round === MAX_TOOL_ROUNDS - 1
    convo = [
      ...convo,
      { role: 'assistant', content: fala || '...' },
      {
        role: 'system',
        content:
          toolResultsPrompt(results, voice, codeMode) +
          (proactive ? `\n${proactive.instruction}` : '') +
          (lastRound
            ? '\nLimite de rodadas de ferramentas atingido: responda AGORA ao usuário com o que tem, sem chamar novas ferramentas de consulta.'
            : '')
      }
    ]
    phase++
    if (voice && codeMode) {
      // VOZ + CÓDIGO: streama a resposta COMPLETA na tela (token a token) e fala um
      // resumo conciso, limpo e GARANTIDAMENTE não-vazio num canal separado. O resumo
      // local sai imediatamente após a ferramenta terminar, então análise de diretório/
      // código não fica muda enquanto a resposta completa ainda está sendo escrita.
      const immediateSpoken = codeVoiceProgressSummary(results)
      if (immediateSpoken) {
        falaVoz = immediateSpoken
        onDelta?.(` ${immediateSpoken}`, phase, 'speak')
      }
      const raw = await streamTurn(cfg, convo, phase, onDelta, 'display', deltaTransform, signal)
      const envN = parseEnvelope(raw)
      if (envN.fala) {
        fala = finalFala(envN.fala, suppressGreeting) // texto completo permanece no chat
        const spoken =
          sanitizeVoiceCodeFala(fala) || 'Análise concluída. Os detalhes principais estão na tela.'
        falaVoz = spoken
        // A conclusão do modelo é falada SEMPRE (a menos que repita o resumo imediato):
        // só o resumo da ferramenta deixava o Ares "anunciar" e nunca terminar de falar.
        if (!isDuplicateSpeech(spoken, immediateSpoken)) onDelta?.(` ${spoken}`, phase, 'speak')
      } else if (!immediateSpoken) {
        // Nem ferramenta nem modelo produziram fala nesta fase: não deixa a voz morrer.
        const fallback = 'Concluído. Os detalhes estão na tela.'
        falaVoz = fallback
        onDelta?.(` ${fallback}`, phase, 'speak')
      }
      mutations = mutations.concat(envN.acoes.filter((a) => !QUERY_TOOLS.has(a.tipo)))
      queries = lastRound ? [] : envN.acoes.filter((a) => QUERY_TOOLS.has(a.tipo))
    } else {
      const raw = await streamTurn(cfg, convo, phase, onDelta, 'both', deltaTransform, signal)
      const envN = parseEnvelope(raw)
      if (envN.fala) fala = finalFala(envN.fala, suppressGreeting)
      mutations = mutations.concat(envN.acoes.filter((a) => !QUERY_TOOLS.has(a.tipo)))
      queries = lastRound ? [] : envN.acoes.filter((a) => QUERY_TOOLS.has(a.tipo))
    }
  }

  mutations = memoryFallback(userText, mutations)
  const validated = validateActions(mutations)
  allNotes.push(...validated.notes)

  // Portão de confiança: ações destrutivas (apagar/limpar/remover) só executam após
  // confirmação. O LLM pergunta na fala; aqui garantimos que nada destrutivo roda
  // sem o "sim" — mesmo se o LLM falhar.
  let toApply = validated.valid
  let heldQuestion: string | undefined
  let outcome: 'none' | 'held' | 'applied' | 'confirmed' | 'cancelled' = 'none'
  if (cfg.ui.confirmDestructive !== false) {
    const pend = getPendingConfirm(sessionId)
    const decision = decideConfirmation({ pending: pend?.actions ?? null, proposed: validated.valid, userText })
    toApply = decision.apply
    outcome = decision.outcome
    heldQuestion = decision.question
    if (decision.hold && decision.hold.length) setPendingConfirm(sessionId, decision.hold, decision.question || 'Confirma?')
    else clearPendingConfirm(sessionId)
  }

  // Snapshot para "desfazer": antes de alterar qualquer dado, guarda o estado atual.
  if (toApply.length) pushUndo(userDataDir(), userText.slice(0, 80))

  const { board, notes, changedBoard } = applyMutations(toApply)
  allNotes.push(...notes)

  // Ajusta a fala exibida conforme a confirmação (a fala falada é a do streaming).
  if (outcome === 'held') {
    if (!/\?/.test(fala)) fala = heldQuestion || fala
    allNotes.push('aguardando confirmação')
  } else if (outcome === 'cancelled') {
    allNotes.push('cancelado')
  }

  appendMessages(sessionId, [
    { id: uid('m'), role: 'user', content: userText, ts: Date.now() },
    { id: uid('m'), role: 'assistant', content: fala, ts: Date.now() }
  ])
  // O resumo de contexto é uma otimização para turnos FUTUROS — não deve atrasar
  // a resposta atual nem a liberação para o próximo comando. Roda em segundo plano.
  void summarizeIfNeeded(sessionId)

  unregisterRun()
  // Se alguma ação (ia.raciocinio/ia.modelo) alterou a config do cérebro durante o
  // turno, devolve a config nova para o renderer refletir nos seletores na hora.
  const cfgAfter = readConfig()
  const brainChanged = JSON.stringify(cfgAfter.nineRouter) !== JSON.stringify(cfg.nineRouter)
  return {
    fala,
    board,
    memory: loadMemory(),
    events: loadEvents(),
    lists: loadLists(),
    quickNotes: loadNotes(),
    reminders: loadReminders(),
    notes: allNotes,
    changedBoard,
    ...(falaVoz ? { falaVoz } : {}),
    ...(brainChanged ? { config: cfgAfter } : {})
  }
}

// Controle de contexto: quando a sessão fica longa, resume o histórico antigo.
async function summarizeIfNeeded(sessionId: string): Promise<void> {
  const s = getSession(sessionId)
  if (!s || s.messages.length <= 24) return
  try {
    const cfg = readConfig()
    const old = s.messages.slice(0, -10)
    const text = old.map((m) => `${m.role === 'user' ? 'Usuário' : 'ARES'}: ${m.content}`).join('\n')
    const resumo = await chatJSON(
      cfg,
      [
        { role: 'system', content: 'Resuma em 4-6 frases os pontos importantes e preferências do usuário desta conversa, em pt-BR. Responda só o resumo.' },
        { role: 'user', content: (s.summary ? `Resumo anterior: ${s.summary}\n\n` : '') + text }
      ],
      false
    )
    if (resumo.trim()) setSessionSummary(sessionId, resumo.trim(), 10)
  } catch {
    /* resumo é melhoria opcional; ignora falhas */
  }
}

/**
 * Auto-extração de fatos úteis da conversa recente. Roda separada do turno (chamada
 * pelo renderer após responder) para não atrasar a fala. Classifica por categoria e
 * relevância; com autoApprove desligado, os fatos ficam pendentes para revisão.
 */
export async function extractFacts(sessionId: string): Promise<MemoryFact[]> {
  const cfg = readConfig()
  if (!cfg.memory.autoExtract) return loadMemory()
  const s = getSession(sessionId)
  if (!s || s.messages.length < 2) return loadMemory()
  const recent = s.messages.slice(-10).map((m) => `${m.role === 'user' ? 'Usuário' : 'ARES'}: ${m.content}`).join('\n')
  const known = memorySummary(800)
  const sys =
    'Você extrai memória curada estilo Hermes: fatos DURADOUROS e úteis sobre o usuário, preferências, correções, perfil, rotina, trabalho, projetos, restrições e interesses. ' +
    'Ignore pedidos pontuais, progresso temporário, logs, saídas brutas, chaves, tokens, prompts, small talk e qualquer coisa efêmera. Não repita fatos já conhecidos. ' +
    'Responda APENAS JSON: {"fatos":[{"texto":"...","categoria":"perfil|preferencias|rotina|trabalho|projetos|restricoes|interesses|outros","confianca":0.0-1.0,"evidencia":"trecho curto"}]}. ' +
    'Se nada relevante, responda {"fatos":[]}. Máximo 3 fatos; cada texto deve ser curto, denso e útil em sessões futuras.'
  let raw = ''
  try {
    raw = await chatJSON(
      cfg,
      [
        { role: 'system', content: sys },
        { role: 'user', content: `Já conhecido:\n${known}\n\nConversa:\n${recent}` }
      ],
      true
    )
  } catch {
    return loadMemory()
  }
  try {
    const obj = JSON.parse(raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim())
    const fatos: { texto?: string; categoria?: string; confianca?: number; evidencia?: string }[] = Array.isArray(obj?.fatos) ? obj.fatos : []
    const status = cfg.memory.autoApprove ? 'active' : 'pending'
    for (const f of fatos.slice(0, 3)) {
      const texto = String(f?.texto || '').trim()
      if (texto.length > 3) {
        addFact(texto, {
          category: asCategory(f?.categoria),
          source: 'auto',
          status,
          confidence: typeof f.confianca === 'number' ? f.confianca : undefined,
          evidence: f.evidencia ? [String(f.evidencia)] : undefined
        })
      }
    }
  } catch {
    /* extração é best-effort */
  }
  return loadMemory()
}

export { buildBriefing, briefingToSpeech }
