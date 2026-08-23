import { Router } from "express";
import multer from "multer";
import { login, logout, me, refresh } from "../controllers/authController";
import { registerUser } from "../controllers/registerController";
import { getMyDocuments, listAdminDocuments, reviewDocument, downloadDocument, viewDocument } from "../controllers/documentController";
import { getMyNotifications, markNotificationAsRead, markAllNotificationsAsRead } from "../controllers/notificationController";
import { subscribePush, unsubscribePush } from "../controllers/pushController";
import { sendPush, getPushHistory } from "../controllers/adminPushController";
import { getAnalyticsDashboard } from "../controllers/adminAnalyticsController";
import { listUniversities, createUniversity, updateUniversity } from "../controllers/universityController";
import { updateUserStatus } from "../controllers/adminUserController";
import { listSchedules, createSchedule, updateSchedule, listRoutes, createRoute, updateRoute } from "../controllers/adminTransportController";
import { createRouteBundle, updateRouteBundle } from "../controllers/adminRouteBundleController";
import { listPickupPoints, createPickupPoint, updatePickupPoint } from "../controllers/pickupPointController";
import { auth } from "../middlewares/auth";
import { cityAccess } from "../middlewares/cityAccess";
import { requireRole } from "../middlewares/permissions";
import { loginRateLimit } from "../middlewares/security";
import { trackAnalytics } from "../middlewares/analytics";
import { getStudentsByRoute, getMyTripPassengers, getAvailableRoutes } from "../controllers/studentController";
import { getDriverRoutes, notifyDriverPendingStudents } from "../controllers/driverController";
import { uploadDocument } from "../controllers/uploadController";
import { listCityAgreements, createCityAgreement, updateCityAgreementStatus, listCities } from "../controllers/cityAgreementController";
import { createReservation, createRoundTripReservation, getMyReservations, cancelReservation, confirmReservation } from "../controllers/reservationController";
import { createMaintenanceTicket, getMyMaintenanceTickets, listMaintenanceTickets, updateMaintenanceTicket } from "../controllers/maintenanceTicketController";
import { getAdminDashboard, listAdminUsers, createDriver, listVehicles, createVehicle, updateVehicle, listAuditLogs } from "../controllers/adminController";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const registerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 2 } });
const entityId = (req) => ({ entityId: Number(req.params?.id) || undefined });

router.post("/auth/login", loginRateLimit, trackAnalytics("auth.login"), login);
router.post("/auth/logout", auth, trackAnalytics("auth.logout"), logout);
router.post("/auth/register", registerUpload.fields([{ name: "photo", maxCount: 1 }, { name: "enrollmentProof", maxCount: 1 }]), trackAnalytics("auth.register"), registerUser);
router.post("/auth/refresh", refresh);
router.get("/auth/me", auth, me);

router.post("/upload", auth, upload.single("file"), trackAnalytics("document.upload", (req) => ({ documentType: req.body?.type })), uploadDocument);
router.get("/documents/my", auth, getMyDocuments);
router.get("/documents/:id/view", auth, viewDocument);
router.get("/documents/:id/download", auth, downloadDocument);
router.get("/admin/documents", auth, requireRole("admin"), cityAccess, listAdminDocuments);
router.patch("/admin/documents/:id/review", auth, requireRole("admin"), cityAccess, trackAnalytics("document.review", entityId), reviewDocument);

router.get("/notifications/my", auth, getMyNotifications);
router.patch("/notifications/read-all", auth, markAllNotificationsAsRead);
router.patch("/notifications/:id/read", auth, markNotificationAsRead);
router.post("/push/subscribe", auth, trackAnalytics("push.subscribe"), subscribePush);
router.delete("/push/unsubscribe", auth, trackAnalytics("push.unsubscribe"), unsubscribePush);
router.post("/admin/push/send", auth, requireRole("admin"), cityAccess, trackAnalytics("push.admin_send", (req) => ({ target: req.body?.target })), sendPush);
router.get("/admin/push/history", auth, requireRole("admin"), cityAccess, getPushHistory);
router.get("/admin/analytics/dashboard", auth, requireRole("admin"), cityAccess, trackAnalytics("screen.admin_analytics"), getAnalyticsDashboard);

router.get("/routes/available", auth, requireRole("student"), trackAnalytics("screen.student_routes"), getAvailableRoutes);
router.get("/students/by-route/:routeId", auth, requireRole("admin", "driver"), cityAccess, getStudentsByRoute);
router.get("/students/my-trip-passengers", auth, requireRole("student"), getMyTripPassengers);
router.get("/driver/routes", auth, requireRole("driver"), cityAccess, trackAnalytics("screen.driver_routes"), getDriverRoutes);
router.post("/driver/notify-pending-students", auth, requireRole("driver"), cityAccess, trackAnalytics("driver.remind_pending", (req) => ({ targetMode: req.body?.targetMode, trip: req.body?.trip })), notifyDriverPendingStudents);

router.post("/reservations/roundtrip", auth, requireRole("student"), trackAnalytics("reservation.roundtrip_create", (req) => ({ dayOfWeek: req.body?.dayOfWeek, shift: req.body?.shift })), createRoundTripReservation);
router.post("/reservations", auth, requireRole("student"), trackAnalytics("reservation.create", (req) => ({ dayOfWeek: req.body?.dayOfWeek, routeId: Number(req.body?.routeId) || undefined })), createReservation);
router.get("/my-reservations", auth, requireRole("student"), getMyReservations);
router.patch("/reservations/:id/cancel", auth, requireRole("student", "admin"), trackAnalytics("reservation.cancel", entityId), cancelReservation);
router.patch("/reservations/:id/confirm", auth, requireRole("student", "admin"), trackAnalytics("reservation.confirm", entityId), confirmReservation);

router.post("/maintenance-tickets", auth, requireRole("driver"), trackAnalytics("maintenance.create", (req) => ({ severity: req.body?.severity, vehicleId: Number(req.body?.vehicleId) || undefined })), createMaintenanceTicket);
router.get("/maintenance-tickets/my", auth, requireRole("driver"), getMyMaintenanceTickets);
router.get("/maintenance-tickets", auth, requireRole("admin"), cityAccess, listMaintenanceTickets);
router.patch("/maintenance-tickets/:id", auth, requireRole("admin"), cityAccess, trackAnalytics("maintenance.update", (req) => ({ ...entityId(req), status: req.body?.status })), updateMaintenanceTicket);

router.get("/admin/dashboard", auth, requireRole("admin"), cityAccess, trackAnalytics("screen.admin_dashboard"), getAdminDashboard);
router.get("/admin/users", auth, requireRole("admin"), cityAccess, listAdminUsers);
router.patch("/admin/users/:id/status", auth, requireRole("admin"), cityAccess, trackAnalytics("user.status_update", (req) => ({ ...entityId(req), status: req.body?.status })), updateUserStatus);
router.post("/admin/drivers", auth, requireRole("admin"), cityAccess, trackAnalytics("driver.create"), createDriver);
router.get("/admin/vehicles", auth, requireRole("admin"), cityAccess, listVehicles);
router.post("/admin/vehicles", auth, requireRole("admin"), cityAccess, trackAnalytics("vehicle.create"), createVehicle);
router.patch("/admin/vehicles/:id", auth, requireRole("admin"), cityAccess, trackAnalytics("vehicle.update", entityId), updateVehicle);
router.get("/admin/universities", auth, requireRole("admin"), cityAccess, listUniversities);
router.post("/admin/universities", auth, requireRole("admin"), cityAccess, trackAnalytics("university.create"), createUniversity);
router.patch("/admin/universities/:id", auth, requireRole("admin"), cityAccess, trackAnalytics("university.update", entityId), updateUniversity);
router.get("/admin/schedules", auth, requireRole("admin"), cityAccess, listSchedules);
router.post("/admin/schedules", auth, requireRole("admin"), cityAccess, trackAnalytics("schedule.create"), createSchedule);
router.patch("/admin/schedules/:id", auth, requireRole("admin"), cityAccess, trackAnalytics("schedule.update", entityId), updateSchedule);
router.get("/admin/pickup-points", auth, requireRole("admin"), cityAccess, listPickupPoints);
router.post("/admin/pickup-points", auth, requireRole("admin"), cityAccess, trackAnalytics("pickup_point.create", (req) => ({ type: req.body?.type })), createPickupPoint);
router.patch("/admin/pickup-points/:id", auth, requireRole("admin"), cityAccess, trackAnalytics("pickup_point.update", entityId), updatePickupPoint);
router.get("/admin/routes", auth, requireRole("admin"), cityAccess, listRoutes);
router.post("/admin/routes/complete", auth, requireRole("admin"), cityAccess, trackAnalytics("route.create", (req) => ({ type: req.body?.type })), createRouteBundle);
router.patch("/admin/routes/:id/complete", auth, requireRole("admin"), cityAccess, trackAnalytics("route.update", entityId), updateRouteBundle);
router.post("/admin/routes", auth, requireRole("admin"), cityAccess, trackAnalytics("route.create_legacy"), createRoute);
router.patch("/admin/routes/:id", auth, requireRole("admin"), cityAccess, trackAnalytics("route.update_legacy", entityId), updateRoute);
router.get("/admin/audit-logs", auth, requireRole("admin"), cityAccess, listAuditLogs);

router.get("/cities", auth, requireRole("admin"), listCities);
router.get("/cities/agreements", auth, requireRole("admin"), listCityAgreements);
router.post("/cities/agreements", auth, requireRole("admin"), trackAnalytics("agreement.create", (req) => ({ partnerCityId: Number(req.body?.partnerCityId) || undefined })), createCityAgreement);
router.patch("/cities/agreements/:id", auth, requireRole("admin"), trackAnalytics("agreement.status_update", (req) => ({ ...entityId(req), status: req.body?.status })), updateCityAgreementStatus);

export default router;
