# API MAP
**Date:** 2026-09-13

## Public Routes
| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| GET | /api/missions/:publicCode | Mission detail + availability | No |
| GET | /api/missions/:publicCode/registrations-live | Live registrations (last 50) | No |
| GET | /api/missions/:publicCode/status | Lightweight status for polling | No |
| GET | /api/volunteers/by-member-id/:memberId | Check member ID exists | No (rate limited) |
| POST | /api/register | Register with audio | No |
| GET | /api/register/status/:registrationId | Check registration status | No |

## Admin Routes
| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST | /api/admin/login | Login, returns session token | No |
| POST | /api/admin/logout | Destroy session | Yes |
| POST | /api/admin/missions | Create mission | Yes |
| GET | /api/admin/missions | List missions (paginated) | Yes |
| GET | /api/admin/missions/:id | Mission detail + availability | Yes |
| PATCH | /api/admin/missions/:id | Update mission fields | Yes |
| POST | /api/admin/missions/:id/toggle-registration | Open/close registration | Yes |
| PATCH | /api/admin/missions/:id/details | Edit details | Yes |
| POST | /api/admin/missions/:id/close | Close permanently | Yes |
| DELETE | /api/admin/missions/:id | Delete mission + all registrations | Yes |
| GET | /api/admin/missions/:id/registrations | All registrations | Yes |
| POST | /api/admin/missions/:id/cancel/:regId | Cancel registration | Yes |
| GET | /api/admin/missions/:id/export | CSV export | Yes |
| GET | /api/admin/registrations/:regId/audio | Audio playback | Yes |

## Telegram Routes
| Method | Path | Purpose |
|--------|------|---------|
| POST | /telegram | Main webhook |
| POST | /telegram/setWebhook | Manual webhook setup |
