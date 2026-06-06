import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { DiagnosticsResult } from '../../shared/types'
import { useAres } from '../lib/store'

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function Bar({ label, percent }: { label: string; percent: number }): JSX.Element {
  const high = percent >= 85
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-cyan-200/55">{label}</span>
        <span className={high ? 'text-amber-300/85' : 'text-cyan-100/85'}>{percent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-black/40">
        <div
          className={`h-full rounded-full transition-all ${high ? 'bg-amber-400/80' : 'bg-cyan-400/70'}`}
          style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  )
}

export default function System(): JSX.Element {
  const { metrics, config } = useAres()
  const [diag, setDiag] = useState<DiagnosticsResult | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      setDiag(await window.ares.diagnostics.get())
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void refresh()
  }, [])

  return (
    <motion.div
      key="system"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="flex h-full min-h-[680px] flex-col p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display text-sm title-track text-cyan-300/60">SISTEMA · DIAGNÓSTICO</h2>
          <p className="mt-1 text-xs text-cyan-200/40">Status dos serviços, localização e dados locais do Ares.</p>
        </div>
        <button onClick={() => void refresh()} className="btn-ghost" disabled={loading}>
          {loading ? 'VERIFICANDO…' : 'ATUALIZAR'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        {!diag ? (
          <div className="grid h-40 place-items-center text-sm text-cyan-200/40">Coletando diagnóstico…</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="RECURSOS DO SISTEMA · AO VIVO">
              {metrics ? (
                <>
                  <Bar label="CPU" percent={metrics.cpuPercent} />
                  <Bar label={`Memória · ${metrics.memUsedGB}/${metrics.memTotalGB} GB`} percent={metrics.memPercent} />
                  <Row k="Tempo ligado" v={formatUptime(metrics.uptimeSec)} />
                  <Row k="Núcleos" v={String(metrics.cores)} />
                  <Row k="Carga (1 min)" v={String(metrics.loadAvg1)} />
                  <Row k="Host" v={metrics.hostname} />
                </>
              ) : (
                <span className="text-[12px] text-cyan-200/45">Coletando telemetria…</span>
              )}
            </Panel>

            <Panel title="CÉREBRO · 9 ROUTER">
              <Status ok={diag.nineRouter.ok} label={diag.nineRouter.ok ? 'Online' : 'Indisponível'} detail={diag.nineRouter.detail} />
              <Row k="URL" v={diag.nineRouter.baseUrl} />
              <Row k="Modelo" v={diag.nineRouter.model} />
            </Panel>

            <Panel title="PONTE · HERMES">
              <Status
                ok={diag.hermes.ok}
                label={diag.hermes.enabled ? (diag.hermes.ok ? 'Online' : 'Indisponível') : 'Desativada'}
                detail={diag.hermes.detail}
              />
              <Row k="URL" v={diag.hermes.baseUrl} />
              <Row k="Comando" v={diag.hermes.messagePath} />
              <Row k="Código" v={diag.hermes.codePath} />
              <Row k="Status" v={diag.hermes.healthPath} />
              <Row k="Timeout" v={`${diag.hermes.timeoutMs} ms`} />
            </Panel>

            <Panel title="PROGRAMAÇÃO">
              {config ? (
                <>
                  <Status
                    ok={config.integrations.code.enabled}
                    label={config.integrations.code.enabled ? 'Ferramentas locais ativas' : 'Desativadas'}
                    detail="leitura e busca em modo somente leitura"
                  />
                  <Row k="Workspace" v={config.integrations.code.workspaceRoot} />
                  <Row k="Raízes" v={config.integrations.code.allowedRoots.join(', ') || '—'} />
                  <Row k="Arquivo máx." v={`${config.integrations.code.maxFileKB} KB`} />
                  <Row k="Contexto Hermes" v={`${config.integrations.code.maxContextChars} chars`} />
                  <Row k="Comandos" v={String(config.integrations.code.allowedCommands.length)} />
                  <Row k="Aplicar patches" v={config.integrations.code.allowPatchApply ? 'permitido' : 'bloqueado'} />
                  <Row
                    k="Terminal"
                    v={
                      config.integrations.code.terminalEnabled
                        ? config.integrations.code.terminalAutoApprove
                          ? 'on · auto'
                          : 'on · pede autorização'
                        : 'desligado'
                    }
                  />
                  <Row k="Controle do PC" v={config.integrations.control.enabled ? 'ativado' : 'desligado'} />
                </>
              ) : (
                <span className="text-[12px] text-cyan-200/45">Configuração ainda indisponível.</span>
              )}
            </Panel>

            <Panel title="TRANSCRIÇÃO · GROQ">
              <Status ok={diag.groq.ok} label={diag.groq.configured ? 'Configurado' : 'Sem chave'} detail={diag.groq.detail} />
            </Panel>

            <Panel title="VOZ · PIPER">
              <Status ok={diag.piper.ready} label={diag.piper.ready ? 'Voz neural pronta' : 'Indisponível (usa Web Speech)'} />
              <Row k="Vozes" v={diag.piper.voices.length ? diag.piper.voices.join(', ') : '—'} />
            </Panel>

            <Panel title="LOCALIZAÇÃO">
              <Status
                ok={!!(diag.location.enabled && diag.location.latitude)}
                label={
                  diag.location.enabled
                    ? diag.location.label || diag.location.city || 'Ativada (sem coordenadas ainda)'
                    : 'Desativada'
                }
                detail={
                  diag.location.updatedAt ? `atualizada em ${new Date(diag.location.updatedAt).toLocaleString('pt-BR')}` : undefined
                }
              />
            </Panel>

            <Panel title="APLICATIVO">
              <Row k="Nome" v={diag.app.name} />
              <Row k="Versão" v={diag.app.version} />
              <Row k="Plataforma" v={diag.app.platform} />
              <Row k="Electron" v={diag.app.electron} />
              <Row k="Node" v={diag.app.node} />
              <Row k="Chrome" v={diag.app.chrome} />
            </Panel>

            <Panel title="DADOS LOCAIS">
              <Row k="Pasta" v={diag.userDataPath} />
              <div className="mt-1 grid gap-1">
                {diag.dataFiles.map((f) => (
                  <div key={f.name} className="flex items-center justify-between text-[12px]">
                    <span className="text-cyan-100/80">{f.name}</span>
                    <span className={f.exists ? 'text-cyan-200/55' : 'text-amber-300/70'}>
                      {f.exists ? `${f.sizeKB} KB` : 'ainda não criado'}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}
      </div>
    </motion.div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="glass rounded-2xl p-4">
      <h3 className="mb-3 text-xs title-track text-cyan-300/60">{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

function Status({ ok, label, detail }: { ok: boolean; label: string; detail?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ok ? 'bg-emerald-400 shadow-glow' : 'bg-amber-400'}`} />
      <span className="text-sm text-cyan-50">{label}</span>
      {detail && <span className="truncate text-[11px] text-cyan-200/45">· {detail}</span>}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 text-[12px]">
      <span className="shrink-0 text-cyan-200/45">{k}</span>
      <span className="min-w-0 break-all text-right text-cyan-100/85">{v}</span>
    </div>
  )
}
