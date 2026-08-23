import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { validateFile, basicContentScan } from "../middlewares/uploadSecurity";
import { moderateUploadedFile } from "../services/contentModerationService";
import { createAuditLog, getRequestAuditData } from "../utils/audit";
import { registerSchema } from "../validators/userSchemas";

function getRegistrationFiles(req) {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  return {
    photo: files.photo?.[0],
    enrollmentProof: files.enrollmentProof?.[0],
  };
}

async function validateRegistrationFile(file: Express.Multer.File, label: string, imageOnly = false) {
  await validateFile(file);
  basicContentScan(file);

  if (imageOnly && !file.mimetype.startsWith("image/")) {
    throw new Error(`${label} deve ser uma imagem`);
  }

  const moderation = await moderateUploadedFile(file);
  if (!moderation.approved) {
    throw new Error(moderation.reason || `${label} reprovado na análise de segurança`);
  }

  return moderation;
}

export async function registerUser(req, res) {
  const parsed = registerSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Dados inválidos",
      details: parsed.error.flatten(),
    });
  }

  const data = parsed.data;
  const { photo, enrollmentProof } = getRegistrationFiles(req);

  if (!data.institution) {
    return res.status(400).json({ error: "Instituição obrigatória para aluno" });
  }

  if (!photo) {
    return res.status(400).json({ error: "Foto de perfil obrigatória" });
  }

  if (!enrollmentProof) {
    return res.status(400).json({ error: "Comprovante de matrícula obrigatório" });
  }

  try {
    const [photoModeration, proofModeration] = await Promise.all([
      validateRegistrationFile(photo, "Foto de perfil", true),
      validateRegistrationFile(enrollmentProof, "Comprovante de matrícula"),
    ]);

    const existingUser = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });

    if (existingUser) {
      return res.status(409).json({ error: "E-mail já cadastrado" });
    }

    if (data.cpf) {
      const existingCpf = await prisma.user.findUnique({ where: { cpf: data.cpf } });
      if (existingCpf) {
        return res.status(409).json({ error: "CPF já cadastrado" });
      }
    }

    const city = await prisma.city.upsert({
      where: {
        name_state: {
          name: data.city,
          state: data.state,
        },
      },
      update: {},
      create: {
        name: data.city,
        state: data.state,
      },
    });

    const senhaHash = await bcrypt.hash(data.password, 10);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          nome: data.name,
          email: data.email.toLowerCase(),
          senha: senhaHash,
          role: "student",
          cpf: data.cpf,
          phone: data.phone,
          birthDate: data.birthDate ? new Date(`${data.birthDate}T12:00:00.000Z`) : undefined,
          institution: data.institution,
          cep: data.cep,
          street: data.street,
          number: data.number,
          neighborhood: data.neighborhood,
          cityId: city.id,
          status: "pending",
        },
      });

      const profileDocument = await tx.userDocument.create({
        data: {
          userId: user.id,
          type: "profile_photo",
          status: "approved",
          fileName: photo.originalname,
          fileData: photo.buffer,
          mimeType: photo.mimetype,
          sizeBytes: photo.size,
          moderationStatus: photoModeration.provider === "external" ? "approved" : "not_required",
        },
      });

      const enrollmentDocument = await tx.userDocument.create({
        data: {
          userId: user.id,
          type: "enrollment_proof",
          status: "pending",
          fileName: enrollmentProof.originalname,
          fileData: enrollmentProof.buffer,
          mimeType: enrollmentProof.mimetype,
          sizeBytes: enrollmentProof.size,
          moderationStatus: proofModeration.provider === "external" ? "approved" : "not_required",
        },
      });

      const userWithPhoto = await tx.user.update({
        where: { id: user.id },
        data: { photo: `db:${profileDocument.id}` },
      });

      return { user: userWithPhoto, enrollmentDocument };
    });

    await createAuditLog({
      userId: result.user.id,
      cityId: city.id,
      action: "create",
      entity: "User",
      entityId: result.user.id,
      description: "Cadastro de aluno realizado com documentos iniciais",
      metadata: {
        enrollmentDocumentId: result.enrollmentDocument.id,
        registrationDocuments: ["profile_photo", "enrollment_proof"],
      },
      ...getRequestAuditData(req, res),
    });

    return res.status(201).json({
      id: result.user.id,
      nome: result.user.nome,
      name: result.user.nome,
      email: result.user.email,
      role: result.user.role,
      status: result.user.status,
      cpf: result.user.cpf,
      phone: result.user.phone,
      birthDate: result.user.birthDate,
      institution: result.user.institution,
      photo: `/documents/${String(result.user.photo).replace("db:", "")}/view`,
      cep: result.user.cep,
      street: result.user.street,
      number: result.user.number,
      neighborhood: result.user.neighborhood,
      cityId: result.user.cityId,
      enrollmentDocumentId: result.enrollmentDocument.id,
      createdAt: result.user.createdAt,
      updatedAt: result.user.updatedAt,
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Não foi possível concluir o cadastro",
    });
  }
}