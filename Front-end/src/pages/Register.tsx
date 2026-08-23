import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Bus, Camera, FileText, GraduationCap, Loader2, Search, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { rnInstitutions } from "@/data/institutions";
import { api } from "@/lib/api";

export type Role = "student" | "driver" | "admin";

interface RegisterProps {
  role: Role;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024;

export default function Register({ role }: RegisterProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [institutionQuery, setInstitutionQuery] = useState("");
  const [institutionOpen, setInstitutionOpen] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    name: "",
    cpf: "",
    email: "",
    phone: "",
    birthDate: "",
    institution: "",
    cep: "",
    street: "",
    number: "",
    neighborhood: "",
    city: "",
    state: "",
    password: "",
  });

  const filteredInstitutions = useMemo(() => {
    const query = institutionQuery.trim().toLowerCase();
    if (!query) return rnInstitutions.slice(0, 8);
    return rnInstitutions
      .filter((name) => name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [institutionQuery]);

  if (role !== "student") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-card border border-border rounded-xl p-6 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary">
            <Bus className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Cadastro indisponível</h1>
          <p className="text-sm text-muted-foreground">
            Contas administrativas e de motorista são criadas pelos responsáveis do sistema.
          </p>
          <Button onClick={() => navigate("/login")} className="w-full">Voltar para login</Button>
        </div>
      </div>
    );
  }

  const handlePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "Arquivo inválido", description: "A foto deve ser uma imagem JPG, PNG ou WEBP.", variant: "destructive" });
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast({ title: "Imagem muito grande", description: "O tamanho máximo é 5 MB.", variant: "destructive" });
      return;
    }

    setPhotoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const removePhoto = () => {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (photoInputRef.current) photoInputRef.current.value = "";
  };

  const handleDocument = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowed = file.type === "application/pdf" || file.type.startsWith("image/");
    if (!allowed) {
      toast({ title: "Arquivo inválido", description: "Envie o comprovante em PDF ou imagem.", variant: "destructive" });
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      toast({ title: "Arquivo muito grande", description: "O tamanho máximo é 5 MB.", variant: "destructive" });
      return;
    }

    setDocFile(file);
  };

  const formatCep = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 8);
    return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
  };

  const fetchCep = async (raw: string) => {
    const masked = formatCep(raw);
    setForm((current) => ({ ...current, cep: masked }));
    const digits = masked.replace(/\D/g, "");

    if (digits.length !== 8) {
      setForm((current) => ({ ...current, city: "", state: "" }));
      return;
    }

    setCepLoading(true);
    try {
      const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      if (!response.ok) throw new Error("Falha ao consultar CEP");
      const data = await response.json();

      if (data.erro) {
        setForm((current) => ({ ...current, city: "", state: "" }));
        toast({ title: "CEP não encontrado", description: "Verifique o CEP digitado.", variant: "destructive" });
        return;
      }

      setForm((current) => ({
        ...current,
        city: data.localidade || "",
        state: data.uf || "",
        street: current.street || data.logradouro || "",
        neighborhood: current.neighborhood || data.bairro || "",
      }));
    } catch {
      toast({ title: "Erro ao buscar CEP", description: "Tente novamente ou verifique sua conexão.", variant: "destructive" });
    } finally {
      setCepLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!photoFile) {
      toast({ title: "Foto obrigatória", description: "Envie uma foto para concluir o cadastro.", variant: "destructive" });
      return;
    }

    if (!docFile) {
      toast({ title: "Comprovante obrigatório", description: "Envie seu comprovante de matrícula.", variant: "destructive" });
      return;
    }

    if (!form.institution) {
      toast({ title: "Instituição obrigatória", description: "Selecione sua instituição na lista.", variant: "destructive" });
      return;
    }

    if (!form.city || !form.state) {
      toast({ title: "CEP inválido", description: "Informe um CEP válido antes de continuar.", variant: "destructive" });
      return;
    }

    const payload = new FormData();
    payload.append("role", "student");
    payload.append("name", form.name);
    payload.append("cpf", form.cpf);
    payload.append("email", form.email);
    payload.append("phone", form.phone);
    payload.append("birthDate", form.birthDate);
    payload.append("institution", form.institution);
    payload.append("cep", form.cep);
    payload.append("street", form.street);
    payload.append("number", form.number);
    payload.append("neighborhood", form.neighborhood);
    payload.append("city", form.city);
    payload.append("state", form.state);
    payload.append("password", form.password);
    payload.append("photo", photoFile);
    payload.append("enrollmentProof", docFile);

    try {
      setSubmitting(true);
      await api.post("/auth/register", payload);
      toast({
        title: "Cadastro enviado",
        description: "Seus dados e documentos foram enviados. Aguarde a aprovação do administrador do município.",
      });
      navigate("/login");
    } catch (error: any) {
      const details = error?.response?.data?.details?.fieldErrors;
      const firstFieldError = details
        ? Object.values(details).flat().find(Boolean)
        : null;

      toast({
        title: "Erro ao cadastrar",
        description: (firstFieldError as string) || error?.response?.data?.error || "Não foi possível concluir o cadastro.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 py-8">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary mb-3">
            <Bus className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-heading font-bold text-foreground">OesteGoU</h1>
          <p className="text-muted-foreground text-sm mt-1">Criar conta de aluno</p>
        </div>

        <div className="flex items-center justify-between mb-4 p-3 rounded-lg border border-border bg-card">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-heading font-semibold text-foreground text-sm">Aluno</p>
              <p className="text-xs text-muted-foreground">Cadastro sujeito à aprovação</p>
            </div>
          </div>
          <button type="button" onClick={() => navigate("/login")} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            ← Voltar
          </button>
        </div>

        <motion.form onSubmit={handleSubmit} className="space-y-4 bg-card p-6 rounded-xl border border-border">
          <div className="space-y-2">
            <Label>Foto <span className="text-destructive">*</span></Label>
            <div className="flex items-center gap-4">
              <div className="relative w-24 h-24 rounded-full overflow-hidden border-2 border-dashed border-border bg-muted/30 flex items-center justify-center shrink-0">
                {photoPreview ? (
                  <>
                    <img src={photoPreview} alt="Pré-visualização" className="w-full h-full object-cover" />
                    <button type="button" onClick={removePhoto} className="absolute top-1 right-1 w-6 h-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center" aria-label="Remover foto">
                      <X className="w-3 h-3" />
                    </button>
                  </>
                ) : <Camera className="w-8 h-8 text-muted-foreground" />}
              </div>
              <div className="flex-1">
                <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhoto} className="hidden" />
                <Button type="button" variant="outline" size="sm" onClick={() => photoInputRef.current?.click()} className="w-full">
                  <Upload className="w-4 h-4 mr-2" />
                  {photoFile ? "Alterar foto" : "Enviar foto"}
                </Button>
                <p className="text-xs text-muted-foreground mt-1">JPG, PNG ou WEBP, até 5 MB</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Nome completo <span className="text-destructive">*</span></Label>
            <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={3} maxLength={120} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cpf">CPF <span className="text-destructive">*</span></Label>
            <Input id="cpf" placeholder="000.000.000-00" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="birthDate">Data de nascimento <span className="text-destructive">*</span></Label>
            <Input id="birthDate" type="date" value={form.birthDate} max={new Date().toISOString().split("T")[0]} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">E-mail <span className="text-destructive">*</span></Label>
            <Input id="email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Telefone <span className="text-destructive">*</span></Label>
            <Input id="phone" placeholder="(00) 00000-0000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
          </div>

          <div className="space-y-2 relative">
            <Label htmlFor="institution">Instituição <span className="text-destructive">*</span></Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="institution"
                className="pl-9"
                placeholder="Digite para buscar (ex: UFRN, IFRN...)"
                value={institutionQuery}
                onFocus={() => setInstitutionOpen(true)}
                onBlur={() => setTimeout(() => setInstitutionOpen(false), 150)}
                onChange={(e) => {
                  setInstitutionQuery(e.target.value);
                  setForm({ ...form, institution: "" });
                  setInstitutionOpen(true);
                }}
                autoComplete="off"
                required
              />
            </div>
            {institutionOpen && filteredInstitutions.length > 0 && (
              <ul className="absolute z-10 w-full mt-1 max-h-56 overflow-auto rounded-md border border-border bg-popover shadow-lg">
                {filteredInstitutions.map((institution) => (
                  <li key={institution}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setForm({ ...form, institution });
                        setInstitutionQuery(institution);
                        setInstitutionOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      {institution}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {institutionOpen && institutionQuery && filteredInstitutions.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma instituição encontrada.</p>
            )}
          </div>

          <div className="pt-2 border-t border-border space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Endereço</h3>
            <div className="space-y-2">
              <Label htmlFor="cep">CEP <span className="text-destructive">*</span></Label>
              <div className="relative">
                <Input id="cep" placeholder="00000-000" value={form.cep} onChange={(e) => fetchCep(e.target.value)} maxLength={9} required />
                {cepLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="city">Cidade</Label>
                <Input id="city" value={form.city} readOnly disabled placeholder="Preenchido pelo CEP" className="bg-muted/50 cursor-not-allowed" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">Estado</Label>
                <Input id="state" value={form.state} readOnly disabled placeholder="UF" className="bg-muted/50 cursor-not-allowed" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="street">Rua <span className="text-destructive">*</span></Label>
              <Input id="street" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} required />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="number">Número <span className="text-destructive">*</span></Label>
                <Input id="number" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} required />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="neighborhood">Bairro <span className="text-destructive">*</span></Label>
                <Input id="neighborhood" value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} required />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Comprovante de matrícula <span className="text-destructive">*</span></Label>
            <input ref={docInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleDocument} className="hidden" />
            <Button type="button" variant="outline" onClick={() => docInputRef.current?.click()} className="w-full justify-start">
              <FileText className="w-4 h-4 mr-2" />
              {docFile ? <span className="truncate">{docFile.name}</span> : "Enviar comprovante"}
            </Button>
            <p className="text-xs text-muted-foreground">PDF, JPG, PNG ou WEBP, até 5 MB</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Senha <span className="text-destructive">*</span></Label>
            <Input id="password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
          </div>

          <Button type="submit" className="w-full" disabled={submitting || cepLoading}>
            {submitting ? "Enviando cadastro..." : "Criar conta"}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            Já tem conta?{" "}
            <button type="button" onClick={() => navigate("/login")} className="text-primary hover:underline font-medium">Entrar</button>
          </p>
        </motion.form>
      </motion.div>
    </div>
  );
}
