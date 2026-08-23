import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Loader2, Wrench } from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { socket } from "@/services/socket";

const STATUS = {
  open: "Aberto",
  in_progress: "Em andamento",
  resolved: "Resolvido",
  canceled: "Cancelado",
} as const;

const SEVERITY = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
} as const;

type TicketStatus = keyof typeof STATUS;
type TicketSeverity = keyof typeof SEVERITY;

interface Ticket {
  id: number;
  title: string;
  description: string;
  severity: TicketSeverity;
  status: TicketStatus;
  resolution?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  vehicle?: { id: number; plate: string; name?: string | null; model?: string | null } | null;
  openedBy?: { id: number; nome: string; email: string } | null;
  resolvedBy?: { id: number; nome: string; email: string } | null;
}

function badgeVariant(status: TicketStatus) {
  if (status === "resolved") return "default";
  if (status === "canceled") return "secondary";
  return "outline";
}

export default function AdminMaintenance() {
  const { toast } = useToast();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>("all");
  const [severityFilter, setSeverityFilter] = useState<"all" | TicketSeverity>("all");
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [nextStatus, setNextStatus] = useState<TicketStatus>("in_progress");
  const [resolution, setResolution] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadTickets() {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { take: 50 };
      if (statusFilter !== "all") params.status = statusFilter;
      if (severityFilter !== "all") params.severity = severityFilter;
      const { data } = await api.get("/maintenance-tickets", { params });
      setTickets(data?.data ?? []);
    } catch (error: any) {
      toast({
        title: "Erro ao carregar chamados",
        description: error?.response?.data?.error ?? "Não foi possível buscar os chamados de manutenção.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTickets();
  }, [statusFilter, severityFilter]);

  useEffect(() => {
    const refresh = () => loadTickets();
    socket.on("maintenance:ticket-created", refresh);
    socket.on("maintenance:ticket-updated", refresh);
    return () => {
      socket.off("maintenance:ticket-created", refresh);
      socket.off("maintenance:ticket-updated", refresh);
    };
  }, [statusFilter, severityFilter]);

  const counts = useMemo(() => ({
    total: tickets.length,
    open: tickets.filter((ticket) => ticket.status === "open").length,
    inProgress: tickets.filter((ticket) => ticket.status === "in_progress").length,
    high: tickets.filter((ticket) => ticket.severity === "high" && ticket.status !== "resolved" && ticket.status !== "canceled").length,
  }), [tickets]);

  function openTicket(ticket: Ticket) {
    setSelected(ticket);
    setNextStatus(ticket.status === "open" ? "in_progress" : ticket.status);
    setResolution(ticket.resolution ?? "");
  }

  async function saveTicket() {
    if (!selected) return;
    if (nextStatus === "resolved" && !resolution.trim()) {
      toast({ title: "Informe a resolução", description: "Descreva a solução antes de concluir o chamado.", variant: "destructive" });
      return;
    }

    try {
      setSaving(true);
      await api.patch(`/maintenance-tickets/${selected.id}`, {
        status: nextStatus,
        resolution: resolution.trim() || undefined,
      });
      toast({ title: "Chamado atualizado" });
      setSelected(null);
      await loadTickets();
    } catch (error: any) {
      toast({
        title: "Erro ao atualizar chamado",
        description: error?.response?.data?.error ?? "Não foi possível salvar a alteração.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Manutenção"
        description="Acompanhe e resolva os chamados abertos pelos motoristas da frota."
        icon={Wrench}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Summary label="Exibidos" value={counts.total} icon={Wrench} />
        <Summary label="Abertos" value={counts.open} icon={AlertTriangle} />
        <Summary label="Em andamento" value={counts.inProgress} icon={Clock3} />
        <Summary label="Alta prioridade" value={counts.high} icon={AlertTriangle} />
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as "all" | TicketStatus)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Filtrar por status"
        >
          <option value="all">Todos os status</option>
          {Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select
          value={severityFilter}
          onChange={(event) => setSeverityFilter(event.target.value as "all" | TicketSeverity)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Filtrar por gravidade"
        >
          <option value="all">Todas as gravidades</option>
          {Object.entries(SEVERITY).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando chamados...
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Nenhum chamado encontrado para os filtros selecionados.</div>
        ) : (
          <div className="divide-y divide-border">
            {tickets.map((ticket) => (
              <button key={ticket.id} type="button" onClick={() => openTicket(ticket)} className="w-full p-4 text-left hover:bg-muted/40 transition-colors">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-heading font-semibold text-foreground">#{ticket.id} · {ticket.title}</p>
                      <Badge variant={badgeVariant(ticket.status)}>{STATUS[ticket.status]}</Badge>
                      <Badge variant={ticket.severity === "high" ? "destructive" : "secondary"}>{SEVERITY[ticket.severity]}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{ticket.description}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {ticket.vehicle?.plate ?? "Veículo não informado"}
                      {ticket.vehicle?.name ? ` · ${ticket.vehicle.name}` : ""}
                      {ticket.openedBy?.nome ? ` · Aberto por ${ticket.openedBy.nome}` : ""}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{new Date(ticket.createdAt).toLocaleString("pt-BR")}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{selected ? `Chamado #${selected.id} · ${selected.title}` : "Chamado"}</DialogTitle>
            <DialogDescription>{selected?.description}</DialogDescription>
          </DialogHeader>

          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Veículo</span><p className="font-medium">{selected.vehicle?.plate ?? "—"}</p></div>
                <div><span className="text-muted-foreground">Motorista</span><p className="font-medium">{selected.openedBy?.nome ?? "—"}</p></div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maintenance-status">Status</Label>
                <select
                  id="maintenance-status"
                  value={nextStatus}
                  onChange={(event) => setNextStatus(event.target.value as TicketStatus)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maintenance-resolution">Resposta / resolução</Label>
                <Textarea
                  id="maintenance-resolution"
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value)}
                  maxLength={500}
                  rows={5}
                  placeholder="Registre a providência tomada ou uma orientação ao motorista."
                />
                <p className="text-xs text-muted-foreground text-right">{resolution.length}/500</p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)} disabled={saving}>Fechar</Button>
            <Button onClick={saveTicket} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Salvando...</> : <><CheckCircle2 className="w-4 h-4 mr-2" /> Salvar</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Summary({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Wrench }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="w-4 h-4" />{label}</div>
      <p className="mt-2 text-2xl font-heading font-bold text-foreground">{value}</p>
    </div>
  );
}
