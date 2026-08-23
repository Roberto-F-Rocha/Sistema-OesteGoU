import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Calendar, Clock, MapPin, Plus, School, Trash2, User, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface PickupPoint {
  id: number;
  name: string;
  address?: string | null;
  type?: "ida" | "volta";
  active?: boolean;
  universityId?: number | null;
}

interface RouteItem {
  id: number;
  name: string;
  active: boolean;
  schedule?: {
    id: number;
    time: string;
    type: "ida" | "volta";
    university?: { name: string } | null;
  };
  city?: { name: string; state: string } | null;
  driver?: { nome: string } | null;
  vehicle?: { name?: string | null; plate: string; capacity?: number | null } | null;
  points?: { pickupPoint?: PickupPoint | null }[];
}

type ReservationStatus = "pending" | "confirmed" | "canceled" | "absent";
interface Reservation {
  id: number;
  status: ReservationStatus;
  routeId: number;
  scheduleId: number;
  pickupPointId?: number | null;
  dayOfWeek?: string | null;
  schedule?: RouteItem["schedule"];
  route?: Omit<RouteItem, "schedule"> | null;
  pickupPoint?: PickupPoint | null;
}

type ShiftKey = "manha" | "tarde" | "noite";
const DAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const SHIFTS: Array<{ key: ShiftKey; label: string }> = [
  { key: "manha", label: "Manhã" },
  { key: "tarde", label: "Tarde" },
  { key: "noite", label: "Noite" },
];

const emptyForm = {
  university: "",
  dayOfWeek: "Segunda",
  shift: "" as ShiftKey | "",
  goingRouteId: "",
  returnRouteId: "",
  goingPickupPointId: "",
  returnPickupPointId: "",
};

function universityName(route: RouteItem) {
  return route.schedule?.university?.name ?? route.name;
}

function getHour(time?: string) {
  const hour = Number((time ?? "").split(":")[0]);
  return Number.isFinite(hour) ? hour : -1;
}

function shiftFromTime(time?: string): ShiftKey {
  const hour = getHour(time);
  if (hour >= 18) return "noite";
  if (hour >= 12) return "tarde";
  return "manha";
}

function routePoints(route?: RouteItem | null, type?: "ida" | "volta") {
  return (route?.points ?? [])
    .map((item) => item.pickupPoint)
    .filter((point): point is PickupPoint => Boolean(point && point.active !== false))
    .filter((point) => !type || !point.type || point.type === type);
}

function autoPointId(points: PickupPoint[]) {
  return points.length === 1 ? String(points[0].id) : "";
}

function statusMeta(status: ReservationStatus) {
  if (status === "confirmed") return { label: "Confirmado", className: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" };
  if (status === "pending") return { label: "Aguardando confirmação", className: "border-amber-500/30 text-amber-700 dark:text-amber-300" };
  if (status === "canceled") return { label: "Não vou", className: "border-destructive/30 text-destructive" };
  return { label: "Ausente", className: "border-destructive/30 text-destructive" };
}

export default function StudentSchedules() {
  const { toast } = useToast();
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [selectedWeekDay, setSelectedWeekDay] = useState("Segunda");

  async function loadData(showLoading = false) {
    try {
      if (showLoading) setLoading(true);
      const [routesResponse, reservationsResponse] = await Promise.all([
        api.get("/routes/available"),
        api.get("/my-reservations"),
      ]);
      setRoutes((routesResponse.data ?? []).filter((route: RouteItem) => route.active));
      setReservations(reservationsResponse.data ?? []);
    } catch {
      toast({ title: "Erro ao carregar horários", description: "Não foi possível buscar as rotas disponíveis.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(true); }, []);
  useLiveRefresh(() => loadData(false), { intervalMs: 10000 });

  const scheduledReservations = useMemo(
    () => reservations.filter((reservation) => reservation.status === "pending" || reservation.status === "confirmed"),
    [reservations],
  );

  const weeklyReservations = useMemo(() => {
    const grouped: Record<string, Reservation[]> = Object.fromEntries(DAYS.map((day) => [day, []]));
    scheduledReservations.forEach((reservation) => {
      const day = reservation.dayOfWeek || "Sem dia";
      if (!grouped[day]) grouped[day] = [];
      grouped[day].push(reservation);
    });
    Object.values(grouped).forEach((items) => items.sort((a, b) => (a.schedule?.time ?? "").localeCompare(b.schedule?.time ?? "")));
    return grouped;
  }, [scheduledReservations]);

  const universities = useMemo(
    () => Array.from(new Set(routes.map(universityName))).sort((a, b) => a.localeCompare(b)),
    [routes],
  );

  const universityRoutes = useMemo(
    () => routes.filter((route) => universityName(route) === form.university),
    [routes, form.university],
  );

  const availableShifts = useMemo(() => {
    if (!form.university) return [];
    return SHIFTS.filter((shift) =>
      universityRoutes.some((route) => route.schedule?.type === "ida" && shiftFromTime(route.schedule?.time) === shift.key) &&
      universityRoutes.some((route) => route.schedule?.type === "volta" && shiftFromTime(route.schedule?.time) === shift.key),
    );
  }, [form.university, universityRoutes]);

  const goingRoutes = useMemo(() => !form.shift ? [] : universityRoutes.filter(
    (route) => route.schedule?.type === "ida" && shiftFromTime(route.schedule?.time) === form.shift,
  ), [universityRoutes, form.shift]);

  const returnRoutes = useMemo(() => !form.shift ? [] : universityRoutes.filter(
    (route) => route.schedule?.type === "volta" && shiftFromTime(route.schedule?.time) === form.shift,
  ), [universityRoutes, form.shift]);

  const goingRoute = goingRoutes.find((route) => String(route.id) === form.goingRouteId) ?? goingRoutes[0] ?? null;
  const returnRoute = returnRoutes.find((route) => String(route.id) === form.returnRouteId) ?? returnRoutes[0] ?? null;
  const goingPoints = routePoints(goingRoute, "ida");
  const returnPoints = routePoints(returnRoute, "volta");

  const canSave = Boolean(
    form.shift && goingRoute?.schedule?.id && returnRoute?.schedule?.id &&
    (goingPoints.length <= 1 || form.goingPickupPointId) &&
    (returnPoints.length <= 1 || form.returnPickupPointId),
  );

  function selectUniversity(value: string) {
    setForm((current) => ({ ...current, university: value, shift: "", goingRouteId: "", returnRouteId: "", goingPickupPointId: "", returnPickupPointId: "" }));
  }

  function selectShift(shift: ShiftKey) {
    const going = universityRoutes.find((route) => route.schedule?.type === "ida" && shiftFromTime(route.schedule?.time) === shift);
    const returning = universityRoutes.find((route) => route.schedule?.type === "volta" && shiftFromTime(route.schedule?.time) === shift);
    setForm((current) => ({
      ...current,
      shift,
      goingRouteId: going ? String(going.id) : "",
      returnRouteId: returning ? String(returning.id) : "",
      goingPickupPointId: autoPointId(routePoints(going, "ida")),
      returnPickupPointId: autoPointId(routePoints(returning, "volta")),
    }));
  }

  async function handleSave() {
    if (!goingRoute?.schedule?.id || !returnRoute?.schedule?.id || !form.shift) return;
    const goingPointId = form.goingPickupPointId || autoPointId(goingPoints);
    const returnPointId = form.returnPickupPointId || autoPointId(returnPoints);

    try {
      setSaving(true);
      await api.post("/reservations/roundtrip", {
        dayOfWeek: form.dayOfWeek,
        shift: form.shift,
        going: { scheduleId: goingRoute.schedule.id, routeId: goingRoute.id, pickupPointId: goingPointId ? Number(goingPointId) : undefined },
        returning: { scheduleId: returnRoute.schedule.id, routeId: returnRoute.id, pickupPointId: returnPointId ? Number(returnPointId) : undefined },
      });
      toast({ title: "Horário salvo", description: `${form.dayOfWeek} foi adicionado. Confirme sua presença antes de cada viagem.` });
      setCreateOpen(false);
      setForm(emptyForm);
      await loadData(false);
    } catch (error: any) {
      toast({ title: "Erro ao salvar", description: error?.response?.data?.error ?? "Não foi possível salvar este horário.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: number) {
    try {
      setRemovingId(id);
      await api.patch(`/reservations/${id}/cancel`);
      toast({ title: "Horário removido" });
      await loadData(false);
    } catch (error: any) {
      toast({ title: "Erro ao remover", description: error?.response?.data?.error ?? "Não foi possível remover este horário.", variant: "destructive" });
    } finally {
      setRemovingId(null);
    }
  }

  const counts = {
    routes: routes.length,
    going: routes.filter((route) => route.schedule?.type === "ida").length,
    returning: routes.filter((route) => route.schedule?.type === "volta").length,
    scheduled: scheduledReservations.length,
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2"><Clock className="w-6 h-6 text-primary" /> Horários</h1>
          <p className="text-muted-foreground text-sm">Monte sua semana e acompanhe os horários ainda pendentes de confirmação.</p>
        </div>
        <Button onClick={() => { setForm({ ...emptyForm, dayOfWeek: selectedWeekDay }); setCreateOpen(true); }}><Plus className="w-4 h-4 mr-2" /> Novo horário</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Summary label="Rotas" value={counts.routes} />
        <Summary label="Ida" value={counts.going} />
        <Summary label="Volta" value={counts.returning} />
        <Summary label="Na semana" value={counts.scheduled} />
      </div>

      <section className="bg-card border border-border rounded-xl p-4 space-y-4">
        <div>
          <h2 className="font-heading font-semibold text-foreground flex items-center gap-2"><Calendar className="w-5 h-5 text-primary" /> Minha semana</h2>
          <p className="text-sm text-muted-foreground">Pendentes e confirmados permanecem visíveis na agenda.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((day) => <button key={day} type="button" onClick={() => setSelectedWeekDay(day)} className={cn("px-3 py-1.5 rounded-md text-xs font-medium border", selectedWeekDay === day ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border")}>{day.slice(0, 3)}</button>)}
        </div>

        {loading ? <div className="p-8 text-center text-sm text-muted-foreground">Carregando horários...</div> : (weeklyReservations[selectedWeekDay]?.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <Calendar className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="font-heading font-semibold">Nenhum horário em {selectedWeekDay}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => { setForm({ ...emptyForm, dayOfWeek: selectedWeekDay }); setCreateOpen(true); }}>Adicionar horário</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {weeklyReservations[selectedWeekDay].map((reservation) => {
              const status = statusMeta(reservation.status);
              return (
                <div key={reservation.id} className="rounded-xl border border-border bg-background/40 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">{reservation.schedule?.university?.name ?? reservation.route?.name ?? "Viagem"}</p>
                      <p className="text-xs text-muted-foreground">{reservation.route?.name ?? "Rota não informada"}</p>
                    </div>
                    <Badge variant="outline" className={status.className}>{status.label}</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p className="flex items-center gap-2"><Clock className="w-4 h-4" /> {reservation.schedule?.time ?? "--:--"} · {reservation.schedule?.type === "volta" ? "Volta" : "Ida"}</p>
                    <p className="flex items-center gap-2"><MapPin className="w-4 h-4" /> {reservation.pickupPoint?.name ?? "Ponto definido pela administração"}</p>
                    <p className="flex items-center gap-2"><User className="w-4 h-4" /> {reservation.route?.driver?.nome ?? "Motorista a definir"}</p>
                  </div>
                  <Button variant="ghost" size="sm" className="w-full text-destructive hover:text-destructive" onClick={() => handleRemove(reservation.id)} disabled={removingId === reservation.id}><Trash2 className="w-4 h-4 mr-2" />{removingId === reservation.id ? "Removendo..." : "Remover"}</Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="flex justify-between gap-4">
              <div><h2 className="text-xl font-heading font-bold flex items-center gap-2"><Clock className="w-5 h-5 text-primary" /> Novo horário</h2><p className="text-sm text-muted-foreground">Escolha ida e volta do mesmo turno.</p></div>
              <button type="button" onClick={() => setCreateOpen(false)}><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-4 mt-5">
              <div className="space-y-2"><Label><School className="w-4 h-4 inline mr-1" />Universidade</Label><select value={form.university} onChange={(event) => selectUniversity(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Selecione...</option>{universities.map((name) => <option key={name}>{name}</option>)}</select></div>
              <div className="space-y-2"><Label>Dia</Label><div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">{DAYS.map((day) => <button key={day} type="button" onClick={() => setForm((current) => ({ ...current, dayOfWeek: day }))} className={cn("p-2 rounded-md border text-xs", form.dayOfWeek === day ? "bg-primary text-primary-foreground" : "bg-background")}>{day.slice(0, 3)}</button>)}</div></div>
              <div className="space-y-2"><Label>Turno</Label><div className="grid grid-cols-3 gap-2">{SHIFTS.map((shift) => { const enabled = availableShifts.some((item) => item.key === shift.key); return <button key={shift.key} type="button" disabled={!enabled} onClick={() => selectShift(shift.key)} className={cn("p-3 rounded-lg border text-sm font-medium", form.shift === shift.key && "border-primary bg-primary/10 text-primary", !enabled && "opacity-40")}>{shift.label}</button>; })}</div></div>

              {form.shift && goingRoute && returnRoute && (
                <div className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-3"><RouteCard title="Ida" route={goingRoute} /><RouteCard title="Volta" route={returnRoute} /></div>
                  {goingRoutes.length > 1 && <SelectRoute label="Rota de ida" routes={goingRoutes} value={String(goingRoute.id)} onChange={(id) => { const route = goingRoutes.find((item) => String(item.id) === id); setForm((current) => ({ ...current, goingRouteId: id, goingPickupPointId: autoPointId(routePoints(route, "ida")) })); }} />}
                  {returnRoutes.length > 1 && <SelectRoute label="Rota de volta" routes={returnRoutes} value={String(returnRoute.id)} onChange={(id) => { const route = returnRoutes.find((item) => String(item.id) === id); setForm((current) => ({ ...current, returnRouteId: id, returnPickupPointId: autoPointId(routePoints(route, "volta")) })); }} />}
                  <PointSelect label="Ponto de ida" points={goingPoints} value={form.goingPickupPointId} onChange={(value) => setForm((current) => ({ ...current, goingPickupPointId: value }))} />
                  <PointSelect label="Ponto de volta" points={returnPoints} value={form.returnPickupPointId} onChange={(value) => setForm((current) => ({ ...current, returnPickupPointId: value }))} />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6"><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button><Button onClick={handleSave} disabled={!canSave || saving}>{saving ? "Salvando..." : "Salvar horário"}</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="bg-card border border-border rounded-xl p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-heading font-bold">{value}</p></div>;
}

function RouteCard({ title, route }: { title: string; route: RouteItem }) {
  return <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground flex items-center gap-1"><ArrowLeftRight className="w-3 h-3" />{title}</p><p className="text-lg font-bold">{route.schedule?.time ?? "--:--"}</p><p className="text-xs text-muted-foreground">{route.name}</p></div>;
}

function SelectRoute({ label, routes, value, onChange }: { label: string; routes: RouteItem[]; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label>{label}</Label><select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{routes.map((route) => <option key={route.id} value={route.id}>{route.name} · {route.schedule?.time}</option>)}</select></div>;
}

function PointSelect({ label, points, value, onChange }: { label: string; points: PickupPoint[]; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label>{label}</Label>{points.length > 1 ? <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Selecione...</option>{points.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}</select> : <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground flex gap-2"><MapPin className="w-4 h-4" />{points[0]?.name ?? "Ponto definido pela administração"}</div>}</div>;
}
