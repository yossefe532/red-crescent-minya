# STATE MACHINES
**Date:** 2026-09-13

## Mission State Machine
```
DRAFT → OPEN → CLOSED (manual or auto)
             ↘ CANCELLED (admin)
CLOSED → (NO REOPEN — missing!)
```
Transitions:
- DRAFT → OPEN: Admin opens registration
- OPEN → CLOSED: Admin closes OR auto-close when full
- OPEN → CANCELLED: Admin cancels
- CLOSED/CANCELLED → (terminal, no reverse)

## Volunteer Registration State Machine
```
CONFIRMED → CANCELLED (admin)
WAITLIST → CONFIRMED (admin promote OR auto-promote on cancel)
WAITLIST → CANCELLED (admin)
CONFIRMED → (terminal unless cancelled)
```

## Wizard State Machine
```
idle → create_title → create_description → create_location → create_start → create_end → create_capacity → create_waitlist → create_confirm → idle
idle → delete_confirm → idle
idle → edit_value → idle
idle → cancelreg_select_mission → cancelreg_select_volunteer → cancelreg_confirm → idle
```
