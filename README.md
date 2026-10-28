# zero-ide

ตัวรันโค้ด C และ C++ บนเว็บ คู่กับเว็บบทเรียน [zero-index](https://github.com/clytie0x/zero-index) ไว้เป็นทางสำรองให้น้องที่ติดตั้ง Code::Blocks ไม่สำเร็จ คอมไพล์และรันในเบราว์เซอร์ของผู้เรียนเองทั้งหมด ไม่มีเซิร์ฟเวอร์รันโค้ด

- เว็บ https://ide.teerapat.codes/ (GitHub Pages ขึ้นด้วย Actions ทุกครั้งที่ push เข้า `main`)
- สถานะ active เริ่ม 28 ต.ค. 2569

## ใช้งานในเครื่อง

```bash
npm ci
npm test          # คอมไพล์และรันโปรแกรมตัวอย่างด้วย clang ตัวเดียวกับบนเว็บ
npm run build     # สร้างเว็บลง dist/ ใช้เวลาราวครึ่งนาที
npm run serve     # เปิด dist/ ที่ http://localhost:8723/
```

`node tools/serve.mjs --slow` เปิดที่พอร์ต 8725 แบบจำลองเน็ตช้า ไว้ดูหน้าจอตอนโหลดตัวคอมไพล์ครั้งแรก

## ทำงานอย่างไร

| ไฟล์ | หน้าที่ |
|---|---|
| `src/toolchain.js` | flag ของ C และ C++ กับขั้นตอนคอมไพล์ ใช้ร่วมกันทั้งเว็บ build และเทส |
| `src/compile-worker.js` | โหลด clang ([@yowasp/clang](https://www.npmjs.com/package/@yowasp/clang) รุ่น 22) แล้วคอมไพล์ใน Web Worker |
| `src/clang-fetch.js` | โหลดไฟล์ clang แบบ `.gz` แล้วคลายในเบราว์เซอร์ เก็บไว้ใน Cache Storage เปิดครั้งต่อไปไม่ต้องโหลดอีก |
| `src/run-worker.js` `src/run-core.js` | รันโปรแกรมใน Worker แยกด้วย WASI ([browser_wasi_shim](https://github.com/bjorn3/browser_wasi_shim)) จำกัด 10 วินาทีและผลลัพธ์ 1 MB |
| `src/stdc++.h` | ใช้แทน `<bits/stdc++.h>` ที่ libc++ ไม่มี ตอน build สร้างเป็น PCH ให้คอมไพล์ C++ เร็วขึ้น |
| `src/share.js` | ลิงก์แชร์โค้ดหลัง `#` |
| `src/sw.js` | service worker เก็บหน้าเว็บไว้ใช้ตอนเน็ตหลุด |
| `tools/build.mjs` | สร้าง `dist/` ทุกไฟล์มี hash ในชื่อ ไฟล์ clang อยู่ใน `clang/<hash>/` |

ตัวเลขที่วัดได้บนเครื่องผู้ดูแล (Chrome) คอมไพล์ C ราว 0.4 วินาที C++ ที่ใช้ `bits/stdc++.h` ราว 0.9 วินาที เปิดครั้งแรกต้องโหลดราว 27 MB ถ้าเลือก C++ โหลด PCH เพิ่มอีกราว 16 MB

## flag

- C `-std=gnu17 -O2 -Wall`
- C++ `-std=gnu++20 -O2 -Wall -fno-exceptions` ตาม IOI ที่ใช้ gnu++20 กับ -O2 แต่เป็น clang ไม่ใช่ GCC
- stack 64 MB หน่วยความจำไม่เกิน 1 GB

## ข้อจำกัด

- ใช้ `try` `catch` `throw` ไม่ได้ เพราะ libc++ ที่มากับ clang ตัวนี้ไม่มีส่วนรองรับ exception
- ข้อความ error เป็นของ clang หน้าตาต่างจาก GCC ในบทเรียน
- อ่านอาร์เรย์เกินขอบไม่มากจะไม่พังแบบ segfault
- ข้อมูลเข้าต้องใส่ก่อนกดรัน

## ลิงก์แชร์

`https://ide.teerapat.codes/#lang=c&code=<A>&in=<B>` โดย `<A>` กับ `<B>` คือข้อความ UTF-8 ที่บีบด้วย deflate แบบ raw แล้วเข้ารหัส base64url ไม่มี `=` ท้าย `lang` เป็น `c` หรือ `cpp` ส่วน `in` ไม่ใส่ก็ได้ ฝั่ง Python สร้างได้ด้วย

```python
import base64, zlib
c = zlib.compressobj(9, zlib.DEFLATED, -15)
code = base64.urlsafe_b64encode(c.compress(src.encode()) + c.flush()).rstrip(b"=").decode()
```

## ขึ้นเว็บ

1. repo `clytie0x/zero-ide` ตั้ง Pages เป็น GitHub Actions
2. DNS ของ teerapat.codes (name.com) เพิ่ม CNAME `ide` ชี้ไป `clytie0x.github.io`
3. ใน Settings > Pages ใส่ custom domain `ide.teerapat.codes` แล้วติ๊ก Enforce HTTPS
