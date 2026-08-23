import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, BellRing, CheckCircle, GraduationCap, Loader2, Mail, Phone, Search, Users, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { socket } from "@/services/socket";

type Trip = "ida" | "volta";
type ReservationStatus = "pending" | "confirmed" | "canceled" | "absent";
type Filter = "all" | ReservationStatus;

interface StudentRow {
  reservationId: number;
  status: ReservationStatus;
  routeId: number;
  routeName: string;
  scheduleType: "ida" | "volta";
  scheduleTime: string;
  pickupPoint?: string | null;
  user: {
    id: number;
    nome: string;
    email?: string | null;
    phone?: string | null;
    institution?: string | null;
  };
}

const DEFAULT_MESSAGE = "Olá! Sua confirmação de presença ainda está pendente. Pode confirmar sua viagem?";

function getStatusInfo(status: ReservationStatus) {
  if (status === "confirmed") return { icon: CheckCircle, color: "text-success", label: "Confirmado" };
  if (status === "pending") return { icon: AlertCircle, color: "text-warning", label: "Pendente" };
  if (status === "canceled") return { icon: XCircle, color: "text-destructive", label: "Não vai" };
  return { icon: XCircle, color: "text-destructive", label: "Ausente" };
}

export default function DriverStudents() {
  const { toast } = useToast();
  const [trip, setTrip] = useState<Trip>("ida");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notificationTarget, setNotificationTarget] = useState<"all" | number | null>(null);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [notifiedIds, setNotifiedIds] = useState<string[]>([]);

  async function loadStudents(showLoader = true) {
    try {
      if (showLoader) setLoading(true);
      const { data } = await api.get("/driver/routes");
      const parsedRows: StudentRow[] = [];

      (data ?? []).forEach((route: any) => {
        (route.reservations ?? []).forEach((reservation: any) => {
          parsedRows.push({
            reservationId: reservation.id,
            status: reservation.status,
            routeId: route.id,
            routeName: route.name,
            scheduleType: route.schedule?.type ?? "ida",
            scheduleTime: route.schedule?.time ?? "--:--",
            pickupPoint: reservation.pickupPoint?.name ?? route.points?.[0]?.pickupPoint?.name ?? null,
            user: reservation.user,
          });
        });
      });

      setRows(parsedRows);
    } catch {
      toast({
        title: "Erro ao carregar alunos",
        description: "Não foi possível buscar os alunos das suas rotas.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStudents();

    const refresh = () => loadStudents(false);
    socket.on("driver:route-updated", refresh);
    socket.on("route:occupancy-updated", refresh);
    socket.on("reservation:created", refresh);
    socket.on("reservation:canceled", refresh);
    socket.on("driver:attendance-changed", refresh);

    return () => {
      socket.off("driver:route-updated", refresh);
      socket.off("route:occupancy-updated", refresh);
      socket.off("reservation:created", refresh);
      socket.off("reservation:canceled", refresh);
      socket.off("driver:attendance-changed", refresh);
    };
  }, []);

  const filtered = useMemo(() => rows.filter((row) => {
    if (row.scheduleType !== trip) return false;
    if (filter !== "all" && row.status !== filter) return false;
    if (!query.trim()) return true;

    const normalized = query.toLowerCase();
    return (
      row.user.nome.toLowerCase().includes(normalized) ||
      (row.user.institution ?? "").toLowerCase().includes(normalized) ||
      row.routeName.toLowerCase().includes(normalized)
    );
  }), [rows, trip, filter, query]);

  const tripRows = useMemo(() => rows.filter((row) => row.scheduleType === trip), [rows, trip]);
  const pendingRows = useMemo(() => filtered.filter((row) => row.status === "pending"), [filtered]);
  const counts = {
    all: tripRows.length,
    confirmed: tripRows.filter((row) => row.status === "confirmed").length,
    pending: tripRows.filter((row) => row.status === "pending").length,
    canceled: tripRows.filter((row) => row.status === "canceled").length,
    absent: tripRows.filter((row) => row.status === "absent").length,
  };

  const notificationLabel = notificationTarget === "all"
    ? `${pendingRows.length} alunos pendentes`
    : rows.find((row) => row.user.id === notificationTarget)?.user.nome ?? "Aluno";
  const selectedPendingRows = notificationTarget === "all"
    ? pendingRows
    : pendingRows.filter((row) => row.user.id === notificationTarget);

  function openNotificationDialog(target: "all" | number) {
    setNotificationTarget(target);
    setMessage(DEFAULT_MESSAGE);
  }

  async function handleSendNotification() {
    const userIds = Array.from(new Set(selectedPendingRows.map((row) => row.user.id)));
    if (userIds.length === 0) {
      toast({
        title: "Nenhum aluno pendente",
        description: "Não há alunos aguardando confirmação nesse filtro.",
        variant: "destructive",
      });
      return;
    }

    try {
      setSending(true);
      const cleanMessage = message.trim() || DEFAULT_MESSAGE;
      const { data } = await api.post("/driver/notify-pending-students", {
        userIds,
        message: cleanMessage,
        trip,
        targetMode: notificationTarget === "all" ? "all" : "single",
      });

      setNotifiedIds((current) => Array.from(new Set([
        ...current,
        ...userIds.map((id) => `${trip}-${id}`),
      ])));
      toast({
        title: "Lembrete enviado",
        description: `Lembrete enviado para ${data?.sent ?? userIds.length} aluno(s). O administrador também foi informado.`,
      });
      setNotificationTarget(null);
      setMessage(DEFAULT_MESSAGE);
    } catch (error: any) {
      toast({
        title: "Erro ao enviar",
        description: error?.response?.data?.error ?? "Não foi possível enviar o lembrete.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  const filterOptions: { value: Filter; label: string }[] = [
    { value: "all", label: "Todos" },
    { value: "confirmed", label: "Confirmados" },
    { value: "pending", label: "Pendentes" },
    { value: "canceled", label: "Não vão" },
    { value: "absent", label: "Ausentes" },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
          <Users className="w-6 h-6 text-primary" /> Alunos
        </h1>
        <p className="text-muted-foreground text-sm">Acompanhe confirmações nas rotas atribuídas a você.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Total", value: counts.all, color: "text-foreground", icon: Users },
          { label: "Confirmados", value: counts.confirmed, color: "text-success", icon: CheckCircle },
          { label: "Pendentes", value: counts.pending, color: "text-warning", icon: AlertCircle },
          { label: "Não vão", value: counts.canceled, color: "text-destructive", icon: XCircle },
          { label: "Ausentes", value: counts.absent, color: "text-destructive", icon: XCircle },
        ].map((item, index) => {
          const Icon = item.icon;
          return (
            <motion.div key={item.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }} className="bg-card border border-border rounded-xl p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{item.label}</span>
                <Icon className={`w-4 h-4 ${item.color}`} />
              </div>
              <p className={`text-2xl font-heading font-bold mt-1 ${item.color}`}>{item.value}</p>
            </motion.div>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <Tabs value={trip} onValueChange={(value) => setTrip(value as Trip)}>
          <TabsList>
            <TabsTrigger value="ida">Ida</TabsTrigger>
            <TabsTrigger value="volta">Volta</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar aluno, instituição..." className="pl-9" />
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {filterOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${filter === option.value ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:text-foreground"}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {pendingRows.length > 0 && (
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => openNotificationDialog("all")}>
            <BellRing className="w-4 h-4 mr-2" /> Lembrar pendentes
          </Button>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Carregando alunos...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhum aluno encontrado com esses filtros.</div>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((row, index) => {
              const { icon: StatusIcon, color, label } = getStatusInfo(row.status);
              const wasNotified = row.status === "pending" && notifiedIds.includes(`${trip}-${row.user.id}`);

              return (
                <motion.li key={`${row.routeId}-${row.reservationId}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: index * 0.02 }} className="p-4 flex items-center gap-3 hover:bg-muted/20 transition-colors">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <GraduationCap className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-foreground truncate">{row.user.nome}</p>
                      <Badge variant="secondary" className="text-[10px] py-0">{row.user.institution ?? "Instituição não informada"}</Badge>
                      {wasNotified && <Badge className="text-[10px] py-0">Lembrado</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{row.routeName} • {row.scheduleTime} • {row.pickupPoint ?? "Ponto não informado"}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      {row.user.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {row.user.phone}</span>}
                      {row.user.email && <span className="hidden sm:flex items-center gap-1"><Mail className="w-3 h-3" /> {row.user.email}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {row.status === "pending" && (
                      <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => openNotificationDialog(row.user.id)}>
                        <BellRing className="w-4 h-4" /><span className="hidden sm:inline">Lembrar</span>
                      </Button>
                    )}
                    <div className={`flex items-center gap-1.5 ${color}`}>
                      <StatusIcon className="w-4 h-4" />
                      <span className="text-xs font-medium hidden sm:inline">{label}</span>
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={notificationTarget !== null} onOpenChange={(open) => !open && !sending && setNotificationTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar lembrete</DialogTitle>
            <DialogDescription>
              {notificationTarget === "all"
                ? `Envie um lembrete para ${pendingRows.length} aluno(s) que ainda não confirmaram na lista atual.`
                : `Envie um lembrete para ${notificationLabel} confirmar a viagem.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium text-foreground">Destino: {notificationLabel}</p>
              <p className="text-xs text-muted-foreground mt-1">Somente reservas realmente pendentes recebem este lembrete.</p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Mensagem</label>
              <Textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder={DEFAULT_MESSAGE} rows={5} />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setMessage(DEFAULT_MESSAGE)}>Usar mensagem padrão</Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setNotificationTarget(null)} disabled={sending}>Cancelar</Button>
            <Button type="button" onClick={handleSendNotification} disabled={sending || selectedPendingRows.length === 0}>
              {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <BellRing className="w-4 h-4 mr-2" />}
              Enviar lembrete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
