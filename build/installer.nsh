; Instalação do ARES no Windows.
; IMPORTANTE: NÃO apagar nada em %APPDATA%\ares — lá ficam config, tarefas,
; memória, sessões e a voz neural (Piper). Instalar por cima ATUALIZA o app e
; PRESERVA todos os dados do usuário. (O NSIS já faz upgrade no mesmo diretório
; pelo appId; manter este macro vazio garante que nenhum dado seja removido.)
!macro customInstall
!macroend
