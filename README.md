# 🎮 Secret Mission — Road Trip Multiplayer

เว็บเกมภารกิจลับแบบปรับจำนวนผู้เล่น ทีม และโจทย์ได้โดยผู้สร้างห้อง เล่นจากมือถือของตัวเองและดูความคืบหน้าแบบ Live ได้ ด้วย **Vite + Vanilla JavaScript + Supabase Auth/Database/Realtime** หน้าเว็บโฮสต์บน Vercel

โปรเจกต์มี 2 game modes ที่แยก state และข้อมูลออกจากกัน:

- **Secret Mission Cards** — โฮสต์ตั้งผู้เล่น 2–24 คน, รถ/ทีม 1–8 คัน และโจทย์ 1–6 ใบต่อคน (รวมไม่เกิน 72 ใบ)
- **สุ่มประโยคลับ / Secret Sentence Draw** — โฮสต์ตั้งความจุสูงสุด 2–24 คนและประโยค 1–6 ข้อต่อคน เริ่มก่อนได้เมื่อมีอย่างน้อย 2 คนและทุกคนที่เข้ามาส่งครบ จากนั้นเปิดสูงสุดทีละ 3 แบบไม่ซ้ำ

คู่มือติดตั้ง ความปลอดภัย และ acceptance tests ของโหมดใหม่อยู่ที่ [`SECRET_SENTENCE_DRAW.md`](./SECRET_SENTENCE_DRAW.md)

## 🎯 กติกาภารกิจ

- 1 คน เลือก 1 คันรถและ 1 Player แล้วรับภารกิจตามจำนวนที่โฮสต์ตั้งไว้ โดย **ไม่ซ้ำกับคนอื่นในห้อง**
- ระหว่างยังไม่สำเร็จ **เจ้าของภารกิจเท่านั้นที่อ่านโจทย์ได้** (ป้องกันด้วย Supabase Row Level Security)
- เมื่อเจ้าของกด **“ทำสำเร็จแล้ว”** และกดยืนยัน ระบบจะบันทึกถาวร และ **เปิดเผยโจทย์ให้ทุกคนที่อยู่ในห้อง** เห็นทันทีใน **Live Board → ภารกิจที่โป๊ะแตก** พร้อมชื่อผู้เล่นและคันรถ และมี **แจ้งเตือนโจทย์ใหม่** ถึงคนที่กำลังดูการ์ดตัวเอง
- จำนวนที่นั่งถูกกระจายระหว่างรถให้ใกล้เคียงกัน และ Leaderboard คำนวณเป้าหมายของแต่ละรถจากจำนวนที่นั่ง × โจทย์ต่อคน
- ปรับปรุงแบบ Real-time ผ่าน Supabase Realtime และโหลดซ้ำทุกประมาณ 15 วินาทีเมื่อแท็บเปิดอยู่ เผื่อสัญญาณโทรศัพท์ขาดหาย
- ผู้เล่นสามารถกดการ์ดของตนเพื่อพลิกดูแล้วซ่อนกลับได้ การกดสำเร็จแล้วไม่สามารถย้อนกลับได้

## 🧰 1. สร้าง Supabase Project

1. ไปที่ **https://supabase.com** แล้วสมัคร/ล็อกอิน
2. คลิก **New project** → เลือก Organization → ใส่ชื่อ เช่น `roadtrip-secret-mission` → ตั้ง Database password และ Region ใกล้ไทย → **Create new project**
3. รอจนโปรเจกต์พร้อมใช้งาน
4. ไปที่ **Authentication → Providers** (หรือ **Authentication → Settings → General** แล้วแต่หน้าตา Dashboard) และเปิด **Anonymous Sign-Ins / Allow anonymous sign-ins** จากนั้นกด Save. ฟีเจอร์นี้ทำให้เพื่อนเข้าระบบได้โดยไม่ต้องสมัครบัญชี

## 🗃️ 2. ติดตั้ง Database, RLS และ Realtime

1. เปิด **Supabase Dashboard → SQL Editor → New query**
2. เปิดไฟล์ [`supabase/schema.sql`](./supabase/schema.sql) ในโปรเจกต์นี้ แล้ว **คัดลอกเนื้อหาทั้งหมด** ไปวางใน SQL Editor
3. คลิก **Run** แล้วรอข้อความ Success
4. SQL นี้สร้างตาราง `trip_rooms`, `trip_players`, `trip_mission_bank`, `trip_assignments`; สร้างภารกิจมากกว่า 48 ข้อ, RPCs, สิทธิ์ RLS และเปิดการติดตาม Realtime ของตาราง `trip_players`, `trip_assignments` ให้แล้ว

### เพิ่มโหมดสุ่มประโยคลับใน Project เดิม

หลังจาก `schema.sql` สำเร็จ ให้รันตามลำดับ:

1. [`supabase/sentence_draw_migration.sql`](./supabase/sentence_draw_migration.sql)
2. [`supabase/flexible_room_settings_migration.sql`](./supabase/flexible_room_settings_migration.sql) เพื่อเพิ่มค่าห้องแบบยืดหยุ่นให้ทั้งสองเกม (ห้องเดิมยังใช้ค่า 16/4/3)
3. [`supabase/sentence_draw_security_checks.sql`](./supabase/sentence_draw_security_checks.sql) เพื่อตรวจ grants, Realtime exposure และ no-repeat invariants

**สำคัญ:** ควรใช้ Supabase Project ใหม่สำหรับเว็บนี้โดยเฉพาะ อย่าใช้ฐานข้อมูลสำคัญที่มีผู้ใช้จริงมาทดลอง SQL โดยไม่สำรองข้อมูล

## 🔑 3. เอา URL + Publishable Key จาก Supabase

1. เปิด **Project Settings → API** / **Project Settings → API Keys** (ตำแหน่งเมนูอาจต่างกันตามเวอร์ชัน Dashboard)
2. คัดลอก **Project URL** เช่น `https://abcdefghijklmnop.supabase.co`
3. คัดลอก **Publishable key** (รูปแบบ `sb_publishable_...`) หรือ **legacy anon key** (ถ้ามี)
4. **ห้ามนำ `service_role`, `sb_secret_...`, หรือ Database password ใส่ในเว็บ** เพราะ `VITE_...` คือข้อมูลที่เบราว์เซอร์มองเห็นได้

## 💻 4. ทดลองรันบนคอมตัวเอง (ทางเลือก)

ต้องมี Node.js เวอร์ชันที่ใช้กับ Vite 7 ได้ (Node.js 20.19+ หรือ 22.12+)

```bash
npm install
```

คัดลอก `.env.example` เป็น `.env` และแก้ 2 ค่าให้เป็นค่าจริง

```dotenv
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
```

แล้วสั่ง:

```bash
npm run dev
```

เปิด URL ที่ Terminal แสดง เช่น `http://localhost:5173`

## 🚀 5. Deploy บน Vercel

1. สร้าง **GitHub Repository** ใหม่
2. Upload/Push ทั้งโปรเจกต์นี้ (ไม่ต้องอัปโหลด `node_modules`, `.env` หรือ `dist`)
3. เปิด https://vercel.com/new → **Import Git Repository** ของโปรเจกต์
4. Vercel จะตรวจพบว่าเป็น **Vite**; ตั้ง `Framework Preset = Vite` ถ้าไม่ถูกเลือกอัตโนมัติ
5. ในส่วน **Environment Variables** เพิ่ม:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | Project URL จาก Supabase |
| `VITE_SUPABASE_ANON_KEY` | Publishable หรือ legacy anon key จาก Supabase |

6. กด **Deploy** แล้วรอจนเว็บขึ้นสถานะ Ready
7. เปิดลิงก์ `https://ชื่อโปรเจกต์.vercel.app` บนมือถือ
8. ถ้าเพิ่งเพิ่ม/แก้ Environment Variables **หลังจาก** Deploy แล้ว ให้ไป Deployments → Redeploy เพื่อให้เว็บรับค่าใหม่

Vercel จะติดตั้ง Dependencies, รัน `npm run build` และเสิร์ฟโฟลเดอร์ `dist` ให้โดยอัตโนมัติ

## 📱 6. วิธีเล่นจริง

**คนจัดทริป**

1. เปิดเว็บ → ตั้งจำนวนผู้เล่น รถ/ทีม และโจทย์ต่อคน → กด **สร้างห้องใหม่**
2. จะได้ **Room Code 8 ตัว** → กด **แชร์ห้อง** ส่งลิงก์เข้า LINE กลุ่ม
3. เลือก Car และ Player ที่ระบบจัดไว้ให้ห้อง แล้วตั้งชื่อเล่น

**เพื่อนแต่ละคน**

1. กดลิงก์ที่ได้รับบนมือถือเครื่องตัวเอง (หรือใส่ Room Code)
2. เลือกคันและ Player ที่ยังว่าง → ตั้งชื่อเล่น → รับภารกิจลับตามจำนวนของห้อง
3. เปิดดูภารกิจ แล้วพยายามทำให้สำเร็จโดยไม่ให้เพื่อนจับได้
4. เมื่อสำเร็จ กด **ทำสำเร็จแล้ว** และ **ยืนยัน**
5. ทุกคนในห้องที่เปิด **Live Board** จะเห็นชื่อ + โจทย์ที่เพิ่งทำสำเร็จ และคะแนนของคันนั้นเพิ่มขึ้นโดยอัตโนมัติ (ไม่ต้องกดรีเฟรช)

**ลองทดสอบก่อนวันทริป:** เปิดลิงก์เดียวกันบนมือถือ 2 เครื่อง สร้างห้อง/เลือกที่นั่งคนละตำแหน่ง ให้เครื่อง A กดสำเร็จ 1 ใบ แล้วดูเครื่อง B ที่ Live Board

## 🔐 ความเป็นส่วนตัวและข้อจำกัด

- ภารกิจที่ยังไม่สำเร็จถูกจำกัดด้วย **RLS**: ผู้เข้าร่วมในห้องอ่านได้เฉพาะการ์ดตัวเอง ส่วนการ์ดที่สำเร็จแล้วทุกคนในห้องอ่านได้
- ผู้เข้าร่วมต้องมี Room Code ก่อนจึงจะเข้าห้องได้ (รหัส 8 ตัว ไม่ใช่ระบบป้องกันความลับระดับสูง)
- ผู้เล่นใช้ **Supabase Anonymous Auth** ไม่ต้องใส่อีเมล แต่ session จะจำไว้ใน **เบราว์เซอร์เครื่องนั้น** ถ้าล้างข้อมูลเว็บ/เข้าโหมดไม่ระบุตัวตน/เปลี่ยนเครื่อง จะเสียสิทธิ์ใน Player เดิม; ตำแหน่งนั้นจะยังถูกจองไว้
- 1 anonymous account เข้าได้ 1 Player ต่อ 1 ห้อง; เพื่อความง่าย **แนะนำ 1 คนต่อ 1 มือถือ**
- ไม่มีระบบกู้ Player หรือ Admin ลบที่นั่งจาก UI ในเวอร์ชันนี้ หากทดสอบผิดพลาด แนะนำให้ **สร้างห้องใหม่**
- ภารกิจที่กดสำเร็จจะเปิดเผยถาวร **ไม่สามารถ Undo ได้** จึงมีกล่องยืนยันก่อนทุกครั้ง
- โค้ดนี้เป็นแอปสำหรับเกมกับเพื่อน ไม่ควรใช้เก็บข้อมูลลับจริง ๆ หรือข้อมูลส่วนบุคคลอ่อนไหว
- หากผู้เล่นอยู่บนเน็ตอ่อน Realtime อาจช้าหรือขาดชั่วคราว หน้าเว็บจะดึงสถานะใหม่ทุก 15 วินาทีขณะที่เปิดแท็บ
- ผู้ขับรถต้องมีสมาธิขับรถอย่างเดียว ให้ผู้โดยสารเป็นคนเล่นหรือกดมือถือ

## 🩹 Troubleshooting

| อาการ | ตรวจสอบ |
|---|---|
| หน้าเว็บขึ้น Setup Required | เพิ่ม Environment Variables แล้ว Redeploy |
| Anonymous sign-ins disabled | ไปเปิด Allow anonymous sign-ins ใน Supabase Auth |
| Could not find function | รัน SQL migrations ทั้ง 3 ไฟล์ตามลำดับให้ครบ |
| เข้าได้ แต่ไม่เห็นคะแนนสด | SQL ต้องเพิ่ม `trip_assignments`, `trip_players` ใน `supabase_realtime`; หน้าเว็บจะ fallback โหลดทุก 15 วินาที |
| 2 คนเลือก Player เดียวกัน | คนที่กดทีหลังจะได้รับข้อความที่นั่งถูกเลือกแล้ว ให้เลือกช่องอื่น |
| เปลี่ยนมือถือแล้วการ์ดเดิมหาย | เป็นข้อจำกัดของ Anonymous Auth (session ผูกกับเบราว์เซอร์เดิม) |
| คนอื่นเห็นการ์ดลับไหม? | ไม่เห็นโจทย์ก่อนสำเร็จ; เห็น **โจทย์ที่สำเร็จแล้ว** ใน Live Board |

## 🗂️ โครงสร้างโปรเจกต์

```text
roadtrip-secret-mission-multiplayer/
├── index.html                 # หน้าเว็บ
├── src/
│   ├── main.js                # UI + Supabase Auth/Realtime/RPC
│   ├── sentence-draw.js       # Secret Sentence Draw UI/state/RPC/Realtime
│   ├── room-settings.js       # Shared validation and team-capacity rules
│   └── style.css              # Mobile-first casual game design
├── supabase/
│   ├── schema.sql             # Secret Mission database / RLS / RPC / seed missions
│   ├── sentence_draw_migration.sql       # Additive migration for Sentence Draw
│   ├── flexible_room_settings_migration.sql # Flexible host settings for both modes
│   └── sentence_draw_security_checks.sql # Read-only security/integrity audit
├── SECRET_SENTENCE_DRAW.md    # Setup, deployment, and acceptance tests
├── .env.example               # ตัวอย่างค่าที่ต้องใส่
├── .gitignore
├── package.json
└── README.md
```

### Links

- [Supabase — Anonymous sign-in](https://supabase.com/docs/reference/javascript/auth-signinanonymously)
- [Supabase — Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Vercel — Deploy Vite](https://vercel.com/docs/frameworks/frontend/vite)
