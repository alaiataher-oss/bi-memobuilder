from __future__ import annotations

from typing import Any

from .outline import content_to_points
from .store import new_document_shell, save_document


def _person(name: str, title: str, rank: str) -> dict[str, str]:
    return {"name": name, "title": title, "rank": rank}


def _sync_points(doc):
    for sec in doc["sections"]:
        content = (sec.get("content") or "").strip()
        if content and not sec.get("points"):
            from .outline import parse_outline_line
            numbered_lines = sum(
                1 for line in content.splitlines()
                if (b := parse_outline_line(line)) and not b.get("blank") and b.get("level", 0) > 0
            )
            if numbered_lines > 1:
                sec["points"] = content_to_points(content)
                sec["body_mode"] = "points"
            else:
                sec["body_mode"] = "prose"
                sec["points"] = []
        else:
            sec.setdefault("body_mode", "prose")
    meta = doc.get("metadata") or {}
    if not doc.get("draft_name"):
        from .filename import suggest_draft_name
        tmpl_code = {
            "M.01_KOORDINASI": "M.01",
            "M.01_UNDANGAN": "M.01",
            "MEETING_REQUEST": "MR",
            "M.02_PERSETUJUAN": "M.02",
            "M.02_PELAPORAN": "M.02",
        }.get(doc.get("type"), "DOC")
        suggested = suggest_draft_name(
            meta.get("satker") or "DMST",
            meta.get("program_strategis") or "PS12",
            tmpl_code,
            meta.get("subject") or "Draft",
        )["suggested"]
        doc["draft_name"] = suggested
        meta["draft_name"] = suggested
    doc.setdefault("attachments_list", [])
    return doc

def sample_m01_koordinasi() -> dict[str, Any]:
    doc = new_document_shell("M.01_KOORDINASI", "koordinasi")
    doc["metadata"].update(
        {
            "classification": "Biasa",
            "satker": "DMST",
            "dari": "Departemen Regional",
            "recipient": "Kepala DPSI",
            "subject": "Permintaan Data Dukungan E-Correspondence",
            "city_date": "Jakarta, 12 September 2026",
            "document_number": "[placeholder]",
            "program_strategis": "PS11",
            "attachments": "1 berkas",
            "tembusan": ["Arsip"],
            "pic": "Rina Pratama — rina@bi.go.id",
            "deadline": "19 September 2026",
        }
    )
    contents = {
        "pembuka": (
            "Dalam rangka penyiapan asesmen tata kelola dokumen elektronik, "
            "diperlukan data dukungan sistem dari DPSI terkait kesiapan layanan e-correspondence."
        ),
        "isi": (
            "Mohon bantuan penyampaian ringkasan kapasitas layanan, catatan gangguan 6 bulan terakhir, "
            "serta rencana peningkatan keandalan. Output yang diharapkan berupa matriks kesiapan satker."
        ),
        "penutup": (
            "Tanggapan diharapkan paling lambat 19 September 2026. Atas perhatian dan kerja samanya, "
            "kami ucapkan terima kasih."
        ),
    }
    for sec in doc["sections"]:
        sec["content"] = contents[sec["key"]]
    doc["signatory"] = _person("Andi Nugroho", "Kepala Divisi Tata Kelola", "Deputy Director")
    return save_document(_sync_points(doc), actor="seed")


def sample_m01_undangan() -> dict[str, Any]:
    doc = new_document_shell("M.01_UNDANGAN", "undangan", budget_impact=True)
    doc["metadata"].update(
        {
            "classification": "Biasa",
            "satker": "DR",
            "dari": "Departemen Regional",
            "recipient": "Para Kepala Kantor Perwakilan Bank Indonesia",
            "subject": "Undangan Rapat Koordinasi Pendalaman Worksheet SGo KPwDN area PUR",
            "city_date": "Jakarta, Desember 2025",
            "document_number": "[placeholder]",
            "program_strategis": "PS12",
            "attachments": "1 (satu) set",
            "pic": "Siti Rahma — siti@bi.go.id",
            "deadline": "Konfirmasi 1 hari sebelum kegiatan",
        }
    )
    contents = {
        "latar_tujuan": (
            "Dalam rangka finalisasi Rencana Kerja dan Penganggaran terkait penguatan manajemen dokumen, "
            "akan dilaksanakan konsinyasi pembahasan tindak lanjut hasil asesmen governance."
        ),
        "kontribusi_peserta": "Kontribusi masing-masing satker tercantum pada tabel.",
        "konfirmasi_pic": (
            "Mohon konfirmasi kehadiran dan/atau pengganti pejabat kepada PIC Siti Rahma "
            "(siti@bi.go.id / 021-0000) paling lambat 22 September 2026."
        ),
        "pembebanan_anggaran": (
            "Kegiatan menimbulkan pembebanan anggaran kedinasan (konsinyasi). "
            "Akun anggaran: 512110 — Kegiatan Penguatan Tata Kelola Dokumen."
        ),
    }
    for sec in doc["sections"]:
        if sec["key"] == "waktu_tempat_agenda":
            sec["fields"] = {
                "hari_tanggal": "Senin, 8 Desember 2025",
                "waktu": "09.00–16.00 WIB",
                "tempat": "Hotel 25 Hours, Jakarta",
                "agenda": "Terlampir",
            }
            sec["content"] = ""
            continue
        sec["content"] = contents[sec["key"]]
        if sec["key"] == "kontribusi_peserta":
            sec["table"] = {
                "columns": ["No", "Satuan Kerja", "Kontribusi/Ekspektasi"],
                "rows": [
                    {"No": "1", "Satuan Kerja": "DHk", "Kontribusi/Ekspektasi": "Aspek legalitas pengelolaan dokumen elektronik"},
                    {"No": "2", "Satuan Kerja": "DPSI", "Kontribusi/Ekspektasi": "Dukungan kebutuhan SI e-correspondence"},
                    {"No": "3", "Satuan Kerja": "DMST", "Kontribusi/Ekspektasi": "Fasilitasi penyusunan rencana aksi"},
                ],
            }
    doc["signatory"] = _person("Budi Santoso", "Kepala Grup Manajemen Strategis", "Director")
    return save_document(_sync_points(doc), actor="seed")


def sample_meeting_request() -> dict[str, Any]:
    doc = new_document_shell("MEETING_REQUEST", "undangan", budget_impact=False)
    doc["metadata"].update(
        {
            "classification": "Biasa",
            "satker": "DMST",
            "recipient": "Tim Penyusun MemoBuilder",
            "subject": "Rapat Koordinasi Prototipe MemoBuilder",
            "city_date": "Jakarta, 12 September 2026",
            "document_number": "-",
            "program_strategis": "PS12",
            "pic": "Alaia — alaia@bi.go.id",
        }
    )
    contents = {
        "latar_tujuan": "Dengan hormat, kami mengundang Bapak/Ibu pada rapat koordinasi prototipe BI MemoBuilder.",
        "kontribusi_peserta": "Mohon menyiapkan catatan kebutuhan template Word resmi per jenis memo.",
        "konfirmasi_pic": "Konfirmasi kehadiran kepada Alaia (alaia@bi.go.id).",
    }
    for sec in doc["sections"]:
        if sec["key"] == "waktu_tempat_agenda":
            sec["fields"] = {
                "hari_tanggal": "Rabu, 17 September 2026",
                "waktu": "13.30–15.00 WIB",
                "tempat": "Microsoft Teams",
                "agenda": "Demo wizard, review validasi, dan daftar open issue DMST",
            }
            sec["content"] = ""
            continue
        sec["content"] = contents[sec["key"]]
    doc["signatory"] = _person("Alaia Aidan", "Intern DMST", "-")
    return save_document(_sync_points(doc), actor="seed")


def sample_m02_persetujuan() -> dict[str, Any]:
    doc = new_document_shell("M.02_PERSETUJUAN", "persetujuan")
    doc["metadata"].update(
        {
            "classification": "Biasa",
            "satker": "DR",
            "dari": "Grup Operasionalisasi Kebijakan PUR dan Supervisi Fungsi Pendukung",
            "recipient": "Yth. Kepala Departemen Regional",
            "via": "Yth. Kepala Grup Operasionalisasi Kebijakan PUR dan Supervisi Fungsi Pendukung",
            "subject": "Permohonan Persetujuan Pelaksanaan Konsinyering Worksheet SGO, KAK, dan Refreshment Implementasi SGO Tahun 2025",
            "city_date": "Jakarta, Juli 2025",
            "document_number": "[placeholder]",
            "program_strategis": "PS12",
            "attachments": "1 (satu) berkas",
            "tembusan": ["Arsip", "Kepala Grup terkait"],
        }
    )
    contents = {
        "tujuan_permohonan": (
            "Memohon persetujuan Kepala DMST atas pelaksanaan asesmen governance dokumen "
            "elektronik pada 10 satker prioritas tahun 2026."
        ),
        "latar_belakang": (
            "1. Latar Belakang\n"
            "a. Asesmen diperlukan untuk memastikan keselarasan praktik penyusunan memorandum "
            "dengan PADG Intern MDEBI dan Pedoman Dokumen Elektronik 2022.\n"
            "b. Data awal menunjukkan variasi format antar satker yang berisiko pada audit trail.\n"
            "2. Penjelasan\n"
            "a. Lingkup asesmen meliputi 10 satker prioritas tahun 2026.\n"
            "b. Output berupa temuan, rekomendasi, dan rencana aksi ber-PIC."
        ),
        "risiko_mitigasi": (
            "Terdapat risiko pelaksanaan asesmen beserta mitigasinya sebagai berikut:\n"
            "1. Risiko ketidaktersediaan narasumber satker. Mitigasi: jadwal fleksibel dan surat pemberitahuan dini.\n"
            "2. Risiko temuan tidak ditindaklanjuti. Mitigasi: rencana aksi ber-PIC dan tenggat."
        ),
        "kesimpulan_rekomendasi": (
            "Berdasarkan hal-hal tersebut di atas, kami mengusulkan hal-hal sebagai berikut:\n"
            "1. Pelaksanaan asesmen governance dokumen pada Oktober–November 2026 dengan PIC Divisi Tata Kelola.\n"
            "2. Alternatif penundaan ke Q1 2027 tidak direkomendasikan karena berisiko menunda perbaikan template.\n"
            "3. Rumusan: Disetujui pelaksanaan asesmen governance dokumen sebagaimana diusulkan."
        ),
        "lembar_pendapat": "",
    }
    for sec in doc["sections"]:
        if sec["key"] == "lembar_pendapat":
            sec["not_needed"] = True
            sec["not_needed_reason"] = "Belum diperlukan pada tahap usulan awal."
            continue
        sec["content"] = contents[sec["key"]]
        if sec["key"] == "risiko_mitigasi":
            sec["table"] = {
                "columns": ["Risiko", "Dampak", "Kemungkinan", "Mitigasi", "PIC"],
                "rows": [
                    {
                        "Risiko": "Ketidaktersediaan narasumber satker",
                        "Dampak": "Sedang",
                        "Kemungkinan": "Sedang",
                        "Mitigasi": "Jadwal fleksibel dan surat pemberitahuan dini",
                        "PIC": "DMST",
                    },
                    {
                        "Risiko": "Temuan tidak ditindaklanjuti",
                        "Dampak": "Tinggi",
                        "Kemungkinan": "Rendah",
                        "Mitigasi": "Rencana aksi ber-PIC dan tenggat",
                        "PIC": "Satker terkait",
                    },
                ],
            }
    doc["accountability"] = {
        "prepared_by": _person("Alaia Taher", "Analis Yunior", "Asisten Manajer"),
        "reviewed_by": _person("Donny Hendri P", "Analis Senior", "Asisten Direktur"),
        "supported_by": _person("Mardianto Jatna", "Analis Utama", "Direktur"),
        "approved_by": _person("Mal Isaini Sri Meyyanti", "Kepala Departemen", "Direktur Eksekutif"),
    }
    return save_document(_sync_points(doc), actor="seed")


def sample_m02_pelaporan() -> dict[str, Any]:
    doc = new_document_shell("M.02_PELAPORAN", "pelaporan")
    doc["metadata"].update(
        {
            "classification": "Biasa",
            "satker": "DMST",
            "recipient": "Kepala DMST",
            "subject": "Laporan Hasil Asesmen Governance Dokumen",
            "city_date": "Jakarta, 12 September 2026",
            "document_number": "[placeholder]",
            "program_strategis": "PS12",
            "attachments": "Ringkasan temuan",
        }
    )
    contents = {
        "tujuan_laporan": (
            "Menyampaikan laporan hasil asesmen governance dokumen pada 10 satker prioritas periode Agustus 2026."
        ),
        "latar_belakang": (
            "1. Asesmen dilakukan melalui review sampel memorandum M.01/M.02 dan wawancara singkat dengan pencipta dokumen.\n"
            "2. Ditemukan 3 pola ketidaksesuaian utama:\n"
            "a. struktur risiko kosong pada M.02 persetujuan;\n"
            "b. penggunaan undangan berbiaya tanpa akun anggaran;\n"
            "c. inkonsistensi penamaan file."
        ),
        "kesimpulan_tindak_lanjut": (
            "Kesimpulan: tingkat kepatuhan format masih bervariasi.\n"
            "Tindak lanjut:\n"
            "1. Sosialisasi rule MemoBuilder pada Oktober 2026.\n"
            "2. Penerbitan checklist validasi satker.\n"
            "3. Evaluasi ulang pada Desember 2026.\n"
            "PIC: Divisi Tata Kelola."
        ),
    }
    for sec in doc["sections"]:
        sec["content"] = contents[sec["key"]]
    doc["accountability"] = {
        "prepared_by": _person("Raka Putra", "Analis Tata Kelola", "Assistant Manager"),
        "reviewed_by": _person("Nina Lestari", "Kepala Tim Governance", "Manager"),
        "supported_by": _person("Budi Santoso", "Kepala Grup", "Director"),
        "received_by": _person("Dewi Kartika", "Kepala DMST", "Senior Director"),
    }
    return save_document(_sync_points(doc), actor="seed")


def seed_all() -> list[dict[str, Any]]:
    return [
        sample_m01_koordinasi(),
        sample_m01_undangan(),
        sample_meeting_request(),
        sample_m02_persetujuan(),
        sample_m02_pelaporan(),
    ]
