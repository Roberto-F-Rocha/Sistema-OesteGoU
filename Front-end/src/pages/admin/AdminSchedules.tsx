import { useEffect, useMemo, useState } from "react";
import { Calendar, MapPin, Pencil, Plus } from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

interface Props { adminCity: string; adminState: string; }
interface University { id: number; name: string; }
interface Driver { id: number; nome: string; email: string; status?: string; }
interface Vehicle { id: number; plate: string; name?: string | null; active?: boolean; }
interface PickupPoint { id: number; name: string; address?: string | null; type: "ida" | "volta"; active: boolean; universityId?: number | null; }
interface Schedule { id: number; time: string; type: "ida" | "volta"; active: boolean; university?: University | null; }
interface RouteItem {
  id: number;
  name: string;
  active: boolean;
  schedule: Schedule;
  driver?: Driver | null;
  vehicle?: Vehicle | null;
  city?: { name: string; state: string } | null;
  points?: { pickupPoint: PickupPoint }[];
}

const emptyForm = {
  id: 0,
  name: "",
  time: "",
  type: "ida" as "ida" | "volta",
  universityId: "",
  driverId: "",
  vehicleId: "",
  pointIds: [] as number[],
  active: true,
};

export default function AdminSchedules({ adminCity, adminState }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [universities, setUniversities] = useState<University[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [points, setPoints] = useState<PickupPoint[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadData() {
    try {
      setLoading(true);
      const [routesRes, universitiesRes, driversRes, vehiclesRes, pointsRes] = await Promise.all([
        api.get("/admin/routes"),
        api.get("/admin/universities"),
        api.get("/admin/users", { params: { role: "driver", status: "active" } }),
        api.get("/admin/vehicles"),
        api.get("/admin/pickup-points", { params: { active: true } }),
      ]);
      setRoutes(routesRes.data ?? []);
      setUniversities(universitiesRes.data ?? []);
      setDrivers(driversRes.data ?? []);
      setVehicles((vehiclesRes.data ?? []).filter((vehicle: Vehicle) => vehicle.active !== false));
      setPoints(pointsRes.data ?? []);
    } catch (error: any) {
      toast({ title: "Erro ao carregar horários", description: error?.response?.data?.error ?? "Não foi possível buscar rotas e cadastros.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  const availablePoints = useMemo(() => points.filter((point) => {
    if (!point.active || point.type !== form.type) return false;
    if (form.type === "volta" && form.universityId) return point.universityId === Number(form.universityId);
    return true;
  }), [points, form.type, form.universityId]);

  function resetForm() { setForm(emptyForm); }

  function togglePoint(id: number) {
    setForm((current) => ({
      ...current,
      pointIds: current.pointIds.includes(id) ? current.pointIds.filter((pointId) => pointId !== id) : [...current.pointIds, id],
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (form.type === "volta" && !form.universityId) {
      toast({ title: "Universidade obrigatória", description: "Rotas de volta precisam de uma universidade para validar os pontos.", variant: "destructive" });
      return;
    }

    const payload = {
      name: form.name,
      time: form.time,
      type: form.type,
      universityId: form.universityId ? Number(form.universityId) : null,
      driverId: form.driverId ? Number(form.driverId) : null,
      vehicleId: form.vehicleId ? Number(form.vehicleId) : null,
      pointIds: form.pointIds,
      active: form.active,
    };

    try {
      setSaving(true);
      if (form.id) {
        await api.patch(`/admin/routes/${form.id}/complete`, payload);
        toast({ title: "Rota atualizada", description: `${form.pointIds.length} ponto(s) vinculados. Horário e rota foram salvos juntos.` });
      } else {
        await api.post("/admin/routes/complete", payload);
        toast({ title: "Rota criada", description: `${form.pointIds.length} ponto(s) vinculados. Horário e rota foram salvos juntos.` });
      }
      setOpen(false);
      resetForm();
      await loadData();
    } catch (error: any) {
      toast({ title: "Erro ao salvar rota", description: error?.response?.data?.error ?? "Verifique os campos obrigatórios.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(route: RouteItem) {
    setForm({
      id: route.id,
      name: route.name,
      time: route.schedule?.time ?? "",
      type: route.schedule?.type ?? "ida",
      universityId: route.schedule?.university?.id ? String(route.schedule.university.id) : "",
      driverId: route.driver?.id ? String(route.driver.id) : "",
      vehicleId: route.vehicle?.id ? String(route.vehicle.id) : "",
      pointIds: (route.points ?? []).map((item) => item.pickupPoint.id),
      active: route.active,
    });
    setOpen(true);
  }

  const orderedRoutes = useMemo(() => [...routes].sort((a, b) => (a.schedule?.time ?? "").localeCompare(b.schedule?.time ?? "")), [routes]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader title="Horários e Rotas" description={`Rotas de ${adminCity} / ${adminState}, com motorista, veículo e pontos vinculados.`} icon={Calendar} actions={<Button onClick={() => { resetForm(); setOpen(true); }}><Plus className="w-4 h-4 mr-1.5" /> Nova rota</Button>} />

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {loading ? <div className="p-8 text-center text-sm text-muted-foreground">Carregando horários...</div> : orderedRoutes.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma rota cadastrada ainda.</div> : (
          <div className="w-full overflow-x-auto">
            <Table className="min-w-[1050px]">
              <TableHeader><TableRow><TableHead>Rota</TableHead><TableHead>Horário</TableHead><TableHead>Universidade</TableHead><TableHead>Motorista</TableHead><TableHead>Veículo</TableHead><TableHead>Pontos</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
              <TableBody>{orderedRoutes.map((route) => (
                <TableRow key={route.id}>
                  <TableCell><p className="font-medium text-foreground">{route.name}</p><p className="text-xs text-muted-foreground">{route.city?.name ?? adminCity}</p></TableCell>
                  <TableCell><p>{route.schedule?.time}</p><p className="text-xs text-muted-foreground">{route.schedule?.type === "volta" ? "Volta" : "Ida"}</p></TableCell>
                  <TableCell>{route.schedule?.university?.name ?? "Não informada"}</TableCell>
                  <TableCell>{route.driver?.nome ?? "Sem motorista"}</TableCell>
                  <TableCell>{route.vehicle ? `${route.vehicle.name ?? "Veículo"} · ${route.vehicle.plate}` : "Sem veículo"}</TableCell>
                  <TableCell><div className="flex flex-wrap gap-1">{(route.points ?? []).length ? route.points!.map((item) => <Badge key={item.pickupPoint.id} variant="secondary">{item.pickupPoint.name}</Badge>) : <span className="text-xs text-muted-foreground">Nenhum ponto</span>}</div></TableCell>
                  <TableCell>{route.active ? "Ativa" : "Inativa"}</TableCell>
                  <TableCell className="text-right"><Button variant="ghost" size="sm" onClick={() => handleEdit(route)}><Pencil className="w-4 h-4" /></Button></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(value) => { if (!saving) setOpen(value); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form.id ? "Editar rota" : "Nova rota"}</DialogTitle><DialogDescription>Salve horário, universidade, motorista, veículo e pontos em uma única operação.</DialogDescription></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label>Nome da rota</Label><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required /></div>
              <div className="space-y-2"><Label>Horário</Label><Input type="time" value={form.time} onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))} required /></div>
              <div className="space-y-2"><Label>Tipo</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as "ida" | "volta", pointIds: [] }))}><option value="ida">Ida</option><option value="volta">Volta</option></select></div>
              <div className="space-y-2 sm:col-span-2"><Label>Universidade</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.universityId} onChange={(event) => setForm((current) => ({ ...current, universityId: event.target.value, pointIds: [] }))}><option value="">Sem universidade</option>{universities.map((university) => <option key={university.id} value={university.id}>{university.name}</option>)}</select></div>
              <div className="space-y-2"><Label>Motorista</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.driverId} onChange={(event) => setForm((current) => ({ ...current, driverId: event.target.value }))}><option value="">Sem motorista</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.nome}</option>)}</select></div>
              <div className="space-y-2"><Label>Veículo</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.vehicleId} onChange={(event) => setForm((current) => ({ ...current, vehicleId: event.target.value }))}><option value="">Sem veículo</option>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name ?? vehicle.plate} · {vehicle.plate}</option>)}</select></div>
              <div className="space-y-2 sm:col-span-2">
                <Label className="flex items-center gap-2"><MapPin className="w-4 h-4" /> Pontos da rota</Label>
                <div className="rounded-lg border border-border p-3 space-y-2 max-h-52 overflow-y-auto">
                  {availablePoints.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum ponto ativo compatível. Cadastre-o primeiro na aba Pontos.</p> : availablePoints.map((point) => (
                    <label key={point.id} className="flex items-start gap-3 rounded-md p-2 hover:bg-muted/50 cursor-pointer">
                      <Checkbox checked={form.pointIds.includes(point.id)} onCheckedChange={() => togglePoint(point.id)} />
                      <span className="text-sm"><span className="font-medium text-foreground">{point.name}</span>{point.address ? <span className="block text-xs text-muted-foreground">{point.address}</span> : null}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Esses pontos serão oferecidos ao aluno ao montar a semana.</p>
              </div>
              <div className="space-y-2 sm:col-span-2"><Label>Status</Label><select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={String(form.active)} onChange={(event) => setForm((current) => ({ ...current, active: event.target.value === "true" }))}><option value="true">Ativa</option><option value="false">Inativa</option></select></div>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
