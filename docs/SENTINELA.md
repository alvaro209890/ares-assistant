# Sentinela de Execução no ARES

A **Sentinela de Execução** é uma funcionalidade proativa do ARES projetada para gerenciar e monitorar processos de longa duração (como servidores de desenvolvimento, executores de testes em modo *watch* ou compilações contínuas) em segundo plano. Ela vigia a saída em tempo real e reage a erros proativamente por voz e tela.

---

## 1. Visão Geral

Ao desenvolver software, frequentemente mantemos processos rodando no terminal (ex: `npm run dev`, `vitest`). Quando esses processos quebram, o desenvolvedor precisa trocar de janela para ler os logs de erro.
A Sentinela automatiza esse processo:
1. Executa o comando em background sem travar a conversa do assistente.
2. Analisa continuamente os fluxos de saída (`stdout` / `stderr`).
3. Ao detectar falhas ou stack traces, extrai a causa raiz e anuncia por voz.
4. Pergunta ao usuário se ele gostaria de despachar o **Prometeu** (o subagente depurador do ARES).
5. Detecta quando o erro é corrigido e anuncia que o processo se recuperou.

---

## 2. Ciclo de Vida da Sentinela

```mermaid
flowchart TD
    A["Início: codigo.observar"] --> B{"Classificar Comando"}
    B -->|Blocked| C["Falha de Segurança"]
    B -->|Confirm| D["Aguardando 'Sim'"]
    B -->|Allowed / Aprovado| E["Processo Iniciado em Background"]
    
    E --> F{"Monitoramento Stream"}
    F -->|Dados no Stream| G["Acumular Chunks (Debounce 1.5s)"]
    G --> H{"Silêncio por 1.5s?"}
    H -->|Sim| I{"Análise do Bloco de Log"}
    
    I -->|Erro Identificado| J["Dedupe (Nova Assinatura?)"]
    J -->|Sim| K["Registrar Pendência & Alerta"]
    K -->|Fala (Rate Limit 1/min) + Toast| F
    J -->|Não (Repetido)| F
    
    I -->|Recuperação Detectada| L["Status: Recovered"]
    L --> M["Fala: 'Voltou ao normal' + Toast"]
    M --> F
    
    E -->|Exit Code / Fechamento| N["Status: Stopped"]
```

### 2.1 Inicialização e Limites
* **Ação**: `codigo.observar {comando, path?}`.
* **Limite**: O ARES suporta no máximo **3 sentinelas simultâneas por sessão** para evitar gargalo de CPU ou vazamento de recursos.
* **Buffer**: A saída acumulada de logs é limitada a **50.000 caracteres** por processo (FIFO), mantendo um histórico relevante para o depurador sem sobrecarregar a memória.

### 2.2 Debounce e Análise
* Logs de erro e stack traces são comumente impressos em múltiplos pedaços (*chunks*).
* Para evitar ler um erro pela metade ou falar em loop, a sentinela aplica um **debounce de 1.5 segundos** de silêncio no stream antes de fechar o bloco de log e extrair a assinatura.

### 2.3 Deduplicação (Dedupe)
* Evita loops de fala e spam de avisos durante *Hot Module Replacement* (HMR) repetidos.
* Cada erro gera uma **Assinatura Única** baseada em:
  `hash = tipo_do_erro | arquivo:linha | mensagem_normalizada`
* Se o mesmo erro ocorrer de forma repetida (sem que o processo se recupere no meio), ele será anunciado **apenas uma vez**.

### 2.4 Rate Limit de Fala
* O feedback falado é limitado a no máximo **1 anúncio por minuto por sentinela**.
* Excedentes dentro da janela de 60s são silenciosamente mostrados apenas como notificações visuais (*toasts*).

### 2.5 Recuperação (Recovery)
* A sentinela vigia marcadores de sucesso (ex: `compiled successfully`, `hmr update`, `vite v... ready`).
* Se o processo estava em estado de erro e um desses marcadores (ou encerramento com exit code 0) for avistado, o status retorna para normal e o ARES anuncia: *"O processo voltou ao normal, senhor."*
* A assinatura do último erro é resetada, permitindo que novas quebras voltem a ser anunciadas.

---

## 3. Segurança e Permissões

A sentinela segue as **mesmas diretrizes rigorosas de segurança** do terminal comum do ARES, utilizando o módulo `classifyCommand`:

1. **Camada 'allowed' (Allowlist / Prefixo Seguro)**: Executa imediatamente sem confirmação (ex: `npm run dev`, `npx vitest`).
2. **Camada 'confirm'**: Apresenta os detalhes e requer autorização verbal ou escrita do usuário ("sim", "pode rodar").
3. **Camada 'blocked' (Denylist / Sudo)**: Comandos perigosos ou destrutivos são rejeitados de imediato.

---

## 4. Integração com o Depurador Prometeu

Quando a sentinela detecta um erro:
1. O ARES anuncia a causa raiz por voz e pergunta se deve depurar.
2. Registra o erro como uma pendência na sessão com validade de 5 minutos.
3. Se a próxima frase do usuário for afirmativa (ex: *"sim"*, *"depura"*, *"corrige"*):
   * O ARES intercepta o turno de imediato.
   * Dispara o subagente `subagente.depurar` (Prometeu), injetando o log exato coletado pela sentinela diretamente na ação.
   * O Prometeu analisa os pontos do stack trace, gera a correção cirúrgica e a aplica de forma autônoma.
   * Quando o processo em background é recompilado com sucesso, a sentinela detecta e confirma: *"O processo voltou ao normal, senhor."*
