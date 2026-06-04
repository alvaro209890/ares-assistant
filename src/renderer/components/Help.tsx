import { AnimatePresence, motion } from 'framer-motion'
import { useAres } from '../lib/store'

// Modal de ajuda: mostra o que o Ares faz com exemplos clicáveis. Clicar envia o
// comando direto ao assistente — a melhor forma de uma pessoa comum aprender usando.
const GROUPS: { title: string; examples: string[] }[] = [
  {
    title: 'Dia a dia',
    examples: ['Faça meu briefing', 'Vai chover hoje?', 'Quais as notícias de hoje?', 'Como está o tempo onde estou?']
  },
  {
    title: 'Lembretes e tempo',
    examples: ['Me lembra de tomar água todo dia às 10h', 'Põe um timer de 10 minutos', 'Me acorda às 7h']
  },
  {
    title: 'Listas e notas',
    examples: ['Adiciona leite na lista de compras', 'Cria uma lista de viagem', 'Anota que a senha do wifi é casa123']
  },
  {
    title: 'Tarefas e agenda',
    examples: ['Crie uma tarefa para pagar a conta de luz', 'Marque dentista sexta às 15h', 'O que tenho amanhã?']
  },
  {
    title: 'Contas e conversões',
    examples: ['Quanto é 30% de 250?', 'Quantos reais são 50 dólares?']
  },
  {
    title: 'Memória',
    examples: ['Lembre-se que eu prefiro respostas curtas', 'Anote que eu trabalho com fotografia']
  }
]

export default function Help(): JSX.Element {
  const { helpOpen, openHelp, sendText, navigate } = useAres()

  const run = (cmd: string) => {
    navigate('assistant')
    openHelp(false)
    void sendText(cmd)
  }

  return (
    <AnimatePresence>
      {helpOpen && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/55"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => openHelp(false)}
          />
          <motion.div
            className="glass-strong fixed left-1/2 top-1/2 z-50 max-h-[82vh] w-[680px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl p-6"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg title-track text-cyan-100 neon-text">O QUE EU SEI FAZER</h2>
                <p className="mt-1 text-xs text-cyan-200/50">Clique em um exemplo para experimentar. Você também pode falar.</p>
              </div>
              <button onClick={() => openHelp(false)} className="text-cyan-200/60 hover:text-cyan-100" title="Fechar">
                ✕
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {GROUPS.map((g) => (
                <section key={g.title} className="rounded-xl border border-cyan-300/12 bg-black/20 p-3">
                  <h3 className="mb-2 text-[11px] title-track text-cyan-300/55">{g.title.toUpperCase()}</h3>
                  <div className="flex flex-col gap-1.5">
                    {g.examples.map((ex) => (
                      <button
                        key={ex}
                        onClick={() => run(ex)}
                        className="rounded-lg border border-cyan-300/15 bg-white/[0.02] px-3 py-1.5 text-left text-sm text-cyan-100/90 transition hover:border-cyan-300/40 hover:text-cyan-50"
                      >
                        “{ex}”
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
