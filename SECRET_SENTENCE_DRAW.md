# Secret Sentence Draw — Setup, Security, and Test Guide

โหมด **สุ่มประโยคลับ** เป็น game mode แยกจาก Secret Mission Cards โดยใช้ Supabase Project, Anonymous Auth และ Vercel project เดิม แต่ใช้ตารางและ RPC คนละชุดทั้งหมด การ reset โหมดนี้จึงไม่แตะ `trip_*` table หรือข้อมูลของโหมดเดิม

## Architecture

| ส่วน | หน้าที่ |
|---|---|
| `sentence_draw_sessions` | ห้อง, host ที่มีสิทธิ์จริง, สถานะ และเลขรอบ |
| `sentence_draw_players` | ผูก anonymous user หนึ่งคนกับผู้เล่นหนึ่งตำแหน่งในห้อง |
| `sentence_draw_submissions` | เก็บ 3 ประโยคส่วนตัว; browser ไม่มีสิทธิ์ select โดยตรง |
| `sentence_draw_rounds` / `sentence_draw_round_items` | ผลการสุ่มที่บันทึกถาวรและ unique ต่อ submission ID |
| `sentence_draw_public_state` | ตัวเลขรวมและสถานะปลอดภัยสำหรับ Realtime; ไม่มีข้อความประโยค |
| RPCs | ตรวจตัวตน, validation, capacity, host permission และ transaction ทั้งหมด |

ทุกเครื่อง subscribe เฉพาะ `sentence_draw_public_state` แล้วเรียก `sentence_draw_room_status` เพื่อโหลดข้อมูลล่าสุดจากฐานข้อมูล Realtime จึงเป็นเพียงสัญญาณให้อัปเดต ไม่ใช่แหล่งข้อมูลหลัก

การสุ่มทำใน `sentence_draw_draw` โดยล็อก session row ด้วย `FOR UPDATE`, ตรวจ `p_expected_round`, เลือกจาก submission ID ที่ยังไม่อยู่ใน `sentence_draw_round_items` และบันทึกทั้งรอบใน transaction เดียว Unique constraints ป้องกันทั้งเลขรอบซ้ำ, ตำแหน่งซ้ำ และ submission record เดิมถูกใช้มากกว่าหนึ่งครั้ง

## Apply to the existing Supabase project

1. สำรองฐานข้อมูล production ตามกระบวนการปกติของทีม
2. เปิด **Supabase Dashboard → SQL Editor → New query**
3. คัดลอกไฟล์ [`supabase/sentence_draw_migration.sql`](./supabase/sentence_draw_migration.sql) ทั้งไฟล์แล้วกด **Run**
4. คัดลอกไฟล์ [`supabase/sentence_draw_security_checks.sql`](./supabase/sentence_draw_security_checks.sql) แล้วกด **Run** ผลลัพธ์สุดท้ายควรเป็น `Secret Sentence Draw security and integrity checks passed` และ result sets ก่อนหน้าต้องว่าง
5. ไม่ต้องเพิ่ม environment variable ใหม่ ใช้ `VITE_SUPABASE_URL` และ `VITE_SUPABASE_ANON_KEY` เดิม ห้ามนำ service-role/secret key เข้า Vercel หรือ frontend

Migration นี้เป็น additive migration: สร้างเฉพาะ object ชื่อ `sentence_draw_*` และไม่แก้หรือลบ `trip_rooms`, `trip_players`, `trip_mission_bank` หรือ `trip_assignments`

## Local run

```bash
npm install
npm run dev
```

ใช้ `.env` เดิมที่ชี้ไป Supabase project ซึ่งรัน migration แล้ว จากหน้าแรกเลือก **สุ่มประโยคลับ**

## Deploy to the existing Vercel project

1. รัน `npm run build`
2. Commit และ push ไป branch ที่ Vercel ใช้เป็น Production Branch (repository นี้ใช้ `main`)
3. รอ deployment เป็น **Ready** โดยไม่ต้องแก้ environment variables
4. ทดสอบลิงก์เชิญหนึ่งครั้งบนมือถืออีกเครื่องก่อนเริ่มเกมจริง

ควรรัน database migration ก่อน deploy frontend เพื่อหลีกเลี่ยงข้อความ `Could not find the function` ระหว่างช่วง rollout

## Acceptance test plan

ใช้ browser profile/incognito ที่แยก storage กัน 16 ชุดเพื่อให้ได้ Supabase Anonymous Auth คนละ identity หากโฮสต์เลือก control-only ให้ใช้ profile โฮสต์เพิ่มอีกหนึ่งชุด แต่จำนวนผู้ส่งยังคง 16 คน

### 1. Collection and privacy

1. Host สร้างห้องและแชร์ลิงก์
2. ให้ผู้เล่น 16 identities เข้าห้อง ตรวจว่าคนที่ 17 ถูกปฏิเสธ
3. แต่ละคนส่ง 3 ประโยค รวม 48 records และลองแก้เฉพาะของตัวเองก่อนเริ่ม
4. ใน Supabase SQL Editor รัน `sentence_draw_security_checks.sql`
5. ใช้ REST/JS client ด้วย authenticated browser token ลอง select `sentence_draw_submissions`; ต้องได้ permission error ขณะที่ `sentence_draw_public_state` อ่านได้เฉพาะ session ที่ตนเป็นสมาชิก

### 2. Permission and premature start

1. ก่อนครบ 16/16 ปุ่มเริ่มต้อง disabled
2. เรียก `sentence_draw_draw` ด้วย token ของผู้เล่นทั่วไป ต้องได้ `DRAW_NOT_HOST`
3. เรียกด้วย host ก่อนครบ ต้องได้ `DRAW_NOT_READY`
4. หลังเริ่ม ลอง join identity ใหม่หรือแก้ submission ต้องได้ `DRAW_ROOM_STARTED` / `DRAW_SUBMISSIONS_LOCKED`

### 3. Concurrency and no-repeat

1. เปิดห้อง host เดียวกันสองแท็บ โดยให้ทั้งสองเห็นรอบเดียวกัน
2. กดสุ่มใกล้กันทั้งสองแท็บ ผลต้องเดินหน้าเพียงหนึ่งรอบ เพราะทั้งสองส่ง `p_expected_round` ค่าเดิม
3. สุ่มต่อจนจบรอบ 16 แล้วรัน `sentence_draw_security_checks.sql`
4. ต้องมี 16 rounds, 48 round items, 48 distinct submission IDs และ remaining `0`; query ตรวจ duplicate ต้องไม่คืนแถว
5. เรียกสุ่มอีกครั้งต้องได้ `DRAW_FINISHED`

### 4. Reconnect and room isolation

1. ระหว่างเกมปิด/เปิดแท็บหรือปิดเน็ตชั่วคราว เมื่อกลับมาต้องเห็นรอบล่าสุดจาก persisted status
2. สร้างอีกห้องพร้อมกันและยืนยันว่า counts, Realtime events และผลสุ่มไม่ข้ามห้อง
3. ส่งข้อความเหมือนกันจากผู้เล่นสองคน ยืนยันว่าทั้งสอง record ถูกสุ่มได้คนละครั้ง เพราะ uniqueness ใช้ submission ID ไม่ใช่ข้อความ

### 5. Regression

1. กลับหน้าแรก เลือก **Secret Mission**
2. สร้างห้อง เลือกรถ/Player รับ 3 ภารกิจ กดสำเร็จ และดู Live Board จากอีกเครื่อง
3. ยืนยันว่า flow และข้อมูล `trip_*` เดิมทำงานเหมือนก่อน migration

## Reset design

Reset จะลบเฉพาะ submissions, rounds และ revealed items ของห้อง Sentence Draw นั้น เพิ่ม `generation` และคืนสถานะเป็น lobby ผู้เล่นเดิมทั้ง 16 identities ยังอยู่ในห้องและต้องส่งชุดใหม่ วิธีนี้ทำให้ทุกเครื่องยังมีสิทธิ์รับ Realtime reset event และไม่กระทบ Secret Mission Cards หากต้องการเปลี่ยนกลุ่มผู้เล่น ให้สร้างห้องใหม่
