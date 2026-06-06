# Confiança na conversa

Por voz, uma transcrição errada não pode virar uma exclusão. Esta camada deixa o
controle por voz **seguro de usar para tudo**: confirmação antes de apagar,
desambiguação quando há vários alvos e correção fácil.

## Confirmação antes de apagar

Ações destrutivas **nunca executam direto**. O Ares pergunta e só age após o "sim".

Ações cobertas (`DESTRUCTIVE_TYPES` em `src/main/confirm.ts`):

- `tarefa.remover`, `coluna.remover`
- `evento.remover`, `lembrete.remover`
- `memoria.remover`
- `lista.limpar`

Fluxo:

1. Você: "apaga a tarefa comprar café".
2. Ares: "Confirma que apago a tarefa 'comprar café'?" — e **não apaga ainda**.
3. Você: "sim" → apaga. / "não" → mantém.

O LLM é instruído a fazer a pergunta na fala, mas a garantia vem de um **portão**
no servidor (`decideConfirmation`): mesmo se o modelo errar, nada destrutivo roda
sem confirmação. Se você já disser tudo junto ("sim, pode apagar"), ele apaga na
hora.

Pareado com o **desfazer**, dá uma rede dupla: confirma antes, e reverte depois.

### Desligar

Em Configurações > Proatividade > **"Confirmar antes de apagar"**
(`ui.confirmDestructive`, ligado por padrão). Desligado, o Ares apaga direto (o
desfazer continua valendo).

## Desambiguação

Se o pedido casar com **vários itens** existentes e não estiver claro qual (o Ares
vê as tarefas/eventos/listas no contexto), ele pergunta "qual deles?" listando as
opções, em vez de chutar. Ex.: "move a reunião" com três reuniões → "Tem três:
cliente, equipe e médico. Qual?".

## Correção

Se você corrigir ("não, eu disse X", "não era isso", "errado"), o Ares reconhece e,
se a última ação foi errada, usa `desfazer` e refaz com o valor certo.

## Como decide (pseudo)

`decideConfirmation({ pending, proposed, userText })`:

- **pendente + "sim"** → executa o que estava segurado.
- **pendente + "não"** → descarta.
- **pendente + outro assunto** → abandona o pendente e trata o novo pedido.
- **nova ação destrutiva + "sim/pode"** → executa na hora.
- **nova ação destrutiva** → segura e pergunta.
- **só ações seguras** → executa normalmente.

## Testes

`tests/confirm.test.ts`: classificação destrutiva, `describeConfirm`,
afirmativo/negativo (sem confundir um comando novo com "sim") e todos os ramos de
`decideConfirmation`, além do store por sessão.
