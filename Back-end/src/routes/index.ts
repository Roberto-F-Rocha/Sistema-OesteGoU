import { Router } from "express";
import multer from "multer";
import { login, logout, me, refresh } from "../controllers/authController";
import { registerUser } from "../controllers/registerController";
import { getMyDocuments, listAdminDocuments, reviewDocument, downloadDocument, viewDocument } from "../controllers/documentController";
import { getMyNotifications, markNotificationAsRead, markAllNotificationsAsRead } from "../controllers/notificationController";
import { subscribePush, unsubscribePush } from "../controllers/pushController";
import { sendPush, getPushHistory } from "../controllers/adminPushController";
import { getAnalyticsDashboard } from "../controllers/adminAnalyticsController";
import { auth } from "../middlewares/auth";
import { cityAccess } from "../middlewares/cityAccess";
import { requireRole } from "../middlewares/permissions";
import { loginRateLimit } from "../middlewares/security";
import { getStudentsByRoute, getMyTripPassengers, getAvailableRoutes } from "../controllers/studentController";
import { getDriverRoutes, notifyDriverPendingStudents } from "../controllers/driverController";
import { uploadDocument } from "../controllers/uploadController";
import { listCityAgreements, createCityAgreement, updateCityAgreementStatus, listCities } from "../controllers/cityAgreementController";
import { createReservation, createRoundTripReservation, getMyReservations, cancelReservation, confirmReservation } from "../controllers/reservationController";
import { createMaintenanceTicket, getMyMaintenanceTickets, listMaintenanceTickets, updateMaintenanceTicket } from "../controllers/maintenanceTicketController";
import { getAdminDashboard, listAdminUsers, updateUserStatus, createDriver, listVehicles, createVehicle, updateVehicle, listSchedules, createSchedule, updateSchedule, listPickupPoints, createPickupPoint, updatePickupPoint, listRoutes, createRoute, updateRoute, listAuditLogs, listUniversities, createUniversity, updateUniversity } from "../controllers/adminController";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const registerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 2 },
});

router.post("/auth/login", loginRateLimit, login);
router.post("/auth/logout", auth, logout);
router.post(
  "/auth/register",
  registerUpload.fields([
    { name: "photo", maxCount: 1 },
    { name: "enrollmentProof", maxCount: 1 },
  ]),
  registerUser,
);
router.post("/auth/refresh", refresh);
router.get("/auth/me", auth, me);

router.post("/upload", auth, upload.single("file"), uploadDocument);
router.get("/documents/my", auth, getMyDocuments);
router.get("/documents/:id/view", auth, viewDocument);
router.get("/documents/:id/download", auth, downloadDocument);
router.get("/admin/documents", auth, requireRole("admin"), cityAccess, listAdminDocuments);
router.patch("/admin/documents/:id/review", auth, requireRole("admin"), cityAccess, reviewDocument);

router.get("/notifications/my", auth, getMyNotifications);
router.patch("/notifications/read-all", auth, markAllNotificationsAsRead);
router.patch("/notifications/:id/read", auth, markNotificationAsRead);
router.post("/push/subscribe", auth, subscribePush);
router.delete("/push/unsubscribe", auth, unsubscribePush);
router.post("/admin/push/send", auth, requireRole("admin"), cityAccess, sendPush);
router.get("/admin/push/history", auth, requireRole("admin"), cityAccess, getPushHistory);
router.get("/admin/analytics/dashboard", auth, requireRole("admin"), cityAccess, getAnalyticsDashboard);

router.get("/routes/available", auth, requireRole("student"), getAvailableRoutes);
router.get("/students/by-route/:routeId", auth, requireRole("admin", "driver"), cityAccess, getStudentsByRoute);
router.get("/students/my-trip-passengers", auth, requireRole("driver"), getMyTripPassengers);
router.get("/driver/routes", auth, requireRole("driver"), cityAccess, getDriverRoutes);
router.post("/driver/notify-pending-students", auth, requireRole("driver"), cityAccess, notifyDriverPendingStudents);

router.post("/reservations/roundtrip", auth, requireRole("student"), createRoundTripReservation);
router.post("/reservations", auth, requireRole("student"), createReservation);
router.get("/my-reservations", auth, requireRole("student"), getMyReservations);
router.patch("/reservations/:id/cancel", auth, requireRole("student", "admin"), cancelReservation);
router.patch("/reservations/:id/confirm", auth, requireRole("student", "admin"), confirmReservation);

router.post("/maintenance-tickets", auth, requireRole("driver", "admin"), createMaintenanceTicket);
router.get("/maintenance-tickets/my", auth, requireRole("driver", "admin"), getMyMaintenanceTickets);
router.get("/maintenance-tickets", auth, requireRole("admin"), cityAccess, listMaintenanceTickets);
router.patch("/maintenance-tickets/:id", auth, requireRole("admin"), cityAccess, updateMaintenanceTicket);

router.get("/admin/dashboard", auth, requireRole("admin"), cityAccess, getAdminDashboard);
router.get("/admin/users", auth, requireRole("admin"), cityAccess, listAdminUsers);
router.patch("/admin/users/:id/status", auth, requireRole("admin"), cityAccess, updateUserStatus);
router.post("/admin/drivers", auth, requireRole("admin"), cityAccess, createDriver);
router.get("/admin/vehicles", auth, requireRole("admin"), cityAccess, listVehicles);
router.post("/admin/vehicles", auth, requireRole("admin"), cityAccess, createVehicle);
router.patch("/admin/vehicles/:id", auth, requireRole("admin"), cityAccess, updateVehicle);
router.get("/admin/universities", auth, requireRole("admin"), cityAccess, listUniversities);
router.post("/admin/universities", auth, requireRole("admin"), cityAccess, createUniversity);
router.patch("/admin/universities/:id", auth, requireRole("admin"), cityAccess, updateUniversity);
router.get("/admin/schedules", auth, requireRole("admin"), cityAccess, listSchedules);
router.post("/admin/schedules", auth, requireRole("admin"), cityAccess, createSchedule);
router.patch("/admin/schedules/:id", auth, requireRole("admin"), cityAccess, updateSchedule);
router.get("/admin/pickup-points", auth, requireRole("admin"), cityAccess, listPickupPoints);
router.post("/admin/pickup-points", auth, requireRole("admin"), cityAccess, createPickupPoint);
router.patch("/admin/pickup-points/:id", auth, requireRole("admin"), cityAccess, updatePickupPoint);
router.get("/admin/routes", auth, requireRole("admin"), cityAccess, listRoutes);
router.post("/admin/routes", auth, requireRole("admin"), cityAccess, createRoute);
router.patch("/admin/routes/:id", auth, requireRole("admin"), cityAccess, updateRoute);
router.get("/admin/audit-logs", auth, requireRole("admin"), cityAccess, listAuditLogs);

router.get("/cities", auth, listCities);
router.get("/cities/agreements", auth, requireRole("admin"), listCityAgreements);
router.post("/cities/agreements", auth, requireRole("admin"), createCityAgreement);
router.patch("/cities/agreements/:id", auth, requireRole("admin"), updateCityAgreementStatus);

export default router;
