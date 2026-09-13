# TELEGRAM CALLBACK MAP
**Date:** 2026-09-13

## Complete Callback Inventory

### nav:*
- nav:home → startCommandHandler (main menu)
- nav:missions → handleListMissions (all)
- nav:missions:active → handleListMissions (active only)
- nav:create → startCreateWizard
- nav:stats → handleStats
- nav:help → helpCommandHandler
- nav:notifications → show notification settings
- nav:health → system health check

### m:*
- m:detail:{id} → handleMissionDetail
- m:detail_pub:{code} → handleMissionByPublicCode
- m:regs:{id} → handleRegistrants
- m:wait:{id} → handleWaitlist
- m:close:{id} → handleToggleRegistration(open=false)
- m:open:{id} → handleToggleRegistration(open=true)
- m:link:{id} → handleGetLink
- m:whatsapp:{id} → handleWhatsAppMessage
- m:edit:{id} → show edit field selector
- m:export:{id} → handleExportCSV
- m:delete:{id} → startDeleteWizard
- m:delete_pick:{id} → executeDelete

### v:*
- v:detail:{regId} → handleVolunteerDetail
- v:audio:{regId} → handleVolunteerAudio
- v:move:{regId}:CONFIRMED → handleVolunteerMove
- v:move:{regId}:WAITLIST → handleVolunteerMove
- v:cancel:{regId} → handleCancelRegConfirm

### wiz:*
- wiz:skip:{field} → handleWizardSkip
- wiz:cancel → clear session + main menu
- wiz:confirm:create → executeCreateMission
- wiz:restart → restart wizard

### confirm:*
- confirm:delete:{id} → executeDelete
- confirm:cancelreg:{id} → handleCancelRegConfirm

### edit:field:*
- edit:field:{id}:{field} → set edit_value state

### delete:pick:*
- delete:pick:{id} → handleDeletePick

### notify:*
- notify:on → enable notifications
- notify:off → disable notifications

## Dead/Orphan Callbacks
- 'noop' — handled as no-op (used for "more" placeholder)
- 'cancel:action' — referenced in notification keyboards but has no handler in handleConfirm (will fall through to default: warn)

## Missing Handlers
- edit:field callback → handled in handleEdit (line 504+) — verified present
