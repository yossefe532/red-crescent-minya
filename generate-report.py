#!/usr/bin/env python3
"""Generate a premium-quality Red Crescent Minya project report in .docx"""

import sys
sys.path.insert(0, "C:/Users/iP/AppData/Local/hermes/skills/productivity/docx/scripts")

from docx import Document
from docx.shared import Pt, Cm, Inches, Mm, RGBColor, Emu
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_ORIENT
from docx.oxml.ns import qn, nsdecls
from docx.oxml import parse_xml
import os

# ── Colors ──────────────────────────────────────────────
RED        = RGBColor(0xC0, 0x39, 0x2B)   # Deep Red (Red Crescent)
DARK_RED   = RGBColor(0x92, 0x20, 0x17)   # Darker Red
GOLD       = RGBColor(0xF3, 0x9C, 0x12)   # Gold accent
DARK_BLUE  = RGBColor(0x2C, 0x3E, 0x50)   # Headings
DARK_GRAY  = RGBColor(0x33, 0x33, 0x33)   # Body text
LIGHT_GRAY = RGBColor(0xEC, 0xF0, 0xF1)   # Table alt row
WHITE      = RGBColor(0xFF, 0xFF, 0xFF)

IMG_DIR = "D:/harmes jop/red-crescent-minya/docs/images"

def create_report():
    doc = Document()
    
    # ── Page Setup ──────────────────────────────────────
    section = doc.sections[0]
    section.page_width  = Mm(210)   # A4
    section.page_height = Mm(297)
    section.top_margin    = Mm(20)
    section.bottom_margin = Mm(20)
    section.left_margin   = Mm(25)
    section.right_margin  = Mm(25)
    
    # ── Default Style ───────────────────────────────────
    style = doc.styles['Normal']
    style.font.name = 'Arial'
    style.font.size = Pt(12)
    style.font.color.rgb = DARK_GRAY
    style.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    style.paragraph_format.line_spacing = 1.5
    style.paragraph_format.space_after = Pt(6)
    
    # Set RTL for Normal
    rPr = style.element.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = parse_xml(f'<w:rFonts {nsdecls("w")} w:eastAsia="Arial"/>')
        rPr.append(rFonts)
    
    # ── Custom Styles ───────────────────────────────────
    def make_style(name, size, color, bold=True, italic=False):
        s = doc.styles.add_style(name, 1)  # 1 = paragraph
        s.font.name = 'Arial'
        s.font.size = Pt(size)
        s.font.color.rgb = color
        s.font.bold = bold
        s.font.italic = italic
        s.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
        s.paragraph_format.line_spacing = 1.5
        return s
    
    make_style('CRTitle',    32, RED,      bold=True)
    make_style('CRSubtitle', 16, GOLD,     bold=False, italic=True)
    make_style('CRH1',       22, DARK_BLUE, bold=True)
    make_style('CRH2',       16, DARK_RED,  bold=True)
    make_style('CRH3',       13, DARK_BLUE, bold=True)
    make_style('CRBody',     12, DARK_GRAY, bold=False)
    make_style('CRBullet',   12, DARK_GRAY, bold=False)
    make_style('CRTocEntry', 13, DARK_BLUE, bold=False)
    
    # ── Helper Functions ────────────────────────────────
    def add_para(text, style_name='CRBody', alignment=WD_ALIGN_PARAGRAPH.LEFT):
        p = doc.add_paragraph(text, style=style_name)
        p.alignment = alignment
        return p
    
    def add_rtl_para(text, style_name='CRBody'):
        p = doc.add_paragraph(text, style=style_name)
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        # Set RTL paragraph
        pPr = p._element.get_or_add_pPr()
        bidi = parse_xml(f'<w:bidi {nsdecls("w")}/>')
        pPr.append(bidi)
        return p
    
    def add_bullet(text, style_name='CRBullet'):
        p = doc.add_paragraph(style='List Bullet')
        p.clear()
        run = p.add_run(text)
        run.font.name = 'Arial'
        run.font.size = Pt(12)
        run.font.color.rgb = DARK_GRAY
        p.paragraph_format.line_spacing = 1.5
        return p
    
    def add_numbered(text):
        p = doc.add_paragraph(style='List Number')
        p.clear()
        run = p.add_run(text)
        run.font.name = 'Arial'
        run.font.size = Pt(12)
        run.font.color.rgb = DARK_GRAY
        p.paragraph_format.line_spacing = 1.5
        return p
    
    def add_image(filename, width_mm=140):
        path = os.path.join(IMG_DIR, filename)
        if os.path.exists(path):
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run()
            run.add_picture(path, width=Mm(width_mm))
            return p
        return None
    
    def add_colored_line(color_hex='C0392B'):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(12)
        pPr = p._element.get_or_add_pPr()
        pBdr = parse_xml(
            f'<w:pBdr {nsdecls("w")}>'
            f'  <w:bottom w:val="single" w:sz="12" w:space="1" w:color="{color_hex}"/>'
            f'</w:pBdr>'
        )
        pPr.append(pBdr)
        return p
    
    def add_table(headers, rows, col_widths=None):
        table = doc.add_table(rows=1 + len(rows), cols=len(headers))
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        
        # Style header row
        hdr = table.rows[0]
        for i, text in enumerate(headers):
            cell = hdr.cells[i]
            cell.text = ''
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            run = p.add_run(text)
            run.font.name = 'Arial'
            run.font.size = Pt(11)
            run.font.bold = True
            run.font.color.rgb = WHITE
            # Red background
            shading = parse_xml(
                f'<w:shd {nsdecls("w")} w:fill="C0392B" w:val="clear"/>'
            )
            cell._element.get_or_add_tcPr().append(shading)
        
        # Data rows
        for r_idx, row in enumerate(rows):
            row_obj = table.rows[r_idx + 1]
            bg = "F9F9F9" if r_idx % 2 == 0 else "FFFFFF"
            for i, text in enumerate(row):
                cell = row_obj.cells[i]
                cell.text = ''
                p = cell.paragraphs[0]
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                run = p.add_run(str(text))
                run.font.name = 'Arial'
                run.font.size = Pt(11)
                run.font.color.rgb = DARK_GRAY
                shading = parse_xml(
                    f'<w:shd {nsdecls("w")} w:fill="{bg}" w:val="clear"/>'
                )
                cell._element.get_or_add_tcPr().append(shading)
        
        # Table borders
        tbl = table._tbl
        tblPr = tbl.tblPr if tbl.tblPr is not None else parse_xml(f'<w:tblPr {nsdecls("w")}/>')
        borders = parse_xml(
            f'<w:tblBorders {nsdecls("w")}>'
            f'  <w:top w:val="single" w:sz="6" w:space="0" w:color="C0392B"/>'
            f'  <w:left w:val="single" w:sz="6" w:space="0" w:color="C0392B"/>'
            f'  <w:bottom w:val="single" w:sz="6" w:space="0" w:color="C0392B"/>'
            f'  <w:right w:val="single" w:sz="6" w:space="0" w:color="C0392B"/>'
            f'  <w:insideH w:val="single" w:sz="4" w:space="0" w:color="C0392B"/>'
            f'  <w:insideV w:val="single" w:sz="4" w:space="0" w:color="C0392B"/>'
            f'</w:tblBorders>'
        )
        tblPr.append(borders)
        
        return table
    
    def add_page_break():
        doc.add_page_break()
    
    def add_heading(text, level=1):
        style_map = {1: 'CRH1', 2: 'CRH2', 3: 'CRH3'}
        s = style_map.get(level, 'CRH1')
        p = add_rtl_para(text, s)
        add_colored_line()
        return p
    
    # ══════════════════════════════════════════════════════
    # COVER PAGE
    # ══════════════════════════════════════════════════════
    
    # Add some spacing at top
    for _ in range(4):
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
    
    # Cover image
    add_image("cover.png", width_mm=160)
    
    # Spacing
    doc.add_paragraph()
    
    # Title
    add_rtl_para('نظام التسجيل الذكي للمهمات', 'CRTitle')
    
    # Subtitle
    add_rtl_para('الجمعية المصرية الهلال الأحمر — فرع المنيا', 'CRSubtitle')
    
    doc.add_paragraph()
    
    # Decorative line
    add_colored_line('C0392B')
    
    # Info block
    info_items = [
        ('المشروع:', 'Smart Mission Registration System MVP'),
        ('الجهة:', 'الجمعية المصرية الهلال الأحمر — فرع المنيا'),
        ('التاريخ:', 'سبتمبر ٢٠٢٦'),
        ('الإصدار:', '1.0.0'),
    ]
    for label, value in info_items:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(2)
        run_label = p.add_run(f'{label}  ')
        run_label.font.name = 'Arial'
        run_label.font.size = Pt(13)
        run_label.font.bold = True
        run_label.font.color.rgb = RED
        run_value = p.add_run(value)
        run_value.font.name = 'Arial'
        run_value.font.size = Pt(13)
        run_value.font.color.rgb = DARK_BLUE
    
    add_page_break()
    
    # ══════════════════════════════════════════════════════
    # TABLE OF CONTENTS
    # ══════════════════════════════════════════════════════
    
    add_heading('فهرس المحتويات', level=1)
    
    toc_items = [
        '١. نبذة عن المشروع',
        '٢. أهداف المشروع',
        '٣. المشكلة التي يحلها المشروع',
        '٤. الحل المقترح',
        '٥. المستخدمون المستهدفون',
        '٦. الميزات الرئيسية',
        '٧. البنية التحتية التقنية',
        '٨. هيكل قاعدة البيانات',
        '٩. سير العمل الرئيسي',
        '١٠. واجهة المستخدم',
        '١١. الأمان والحماية',
        '١٢. خطة النشر والتكاليف',
        '١٣. المستقبل والتحسينات المقترحة',
        '١٤. الخاتمة',
    ]
    
    for item in toc_items:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.left_indent = Cm(1)
        run = p.add_run(item)
        run.font.name = 'Arial'
        run.font.size = Pt(13)
        run.font.color.rgb = DARK_BLUE
        # Add dot leader
        run2 = p.add_run('  ●  ●  ●')
        run2.font.size = Pt(8)
        run2.font.color.rgb = LIGHT_GRAY
    
    add_page_break()
    
    # ══════════════════════════════════════════════════════
    # SECTION 1: نبذة عن المشروع
    # ══════════════════════════════════════════════════════
    
    add_heading('١. نبذة عن المشروع', level=1)
    
    add_rtl_para(
        'نظام التسجيل الذكي للمهمات هو نظام ويب متكامل صُمم خصيصاً للجمعية المصرية الهلال الأحمر — فرع المنيا، '
        'بهدف أتمتة عملية تسجيل المتطوعين في المهمات والإغاثية. يُعد هذا النظام بديلاً حديثاً وفعلاً لأسلوب التسجيل '
        'التقليدي عبر تطبيقات المراسلة مثل واتساب.'
    )
    
    add_rtl_para(
        'يُتيح النظام للمدير (Admin) إنشاء مهمات جديدة وتحديد سعتها القصوى، ثم يُرسل رابطاً مختصراً للمتطوعين '
        'لتسجيل أسمائهم مباشرة. يتم التحقق من هوية المتطوع عبر رقم العضوية، ويتم تسجيل تأكيد صوتي إلزامي لكل '
        'متطوع للتأكد من موافقته على المشاركة.'
    )
    
    add_rtl_para(
        'يتميز النظام بسهولة الاستخدام والسرعة الفائقة — يمكن للمتطوع الماهر تسجيل اسمه في أقل من ٢٠ ثانية، '
        'مما يجعله مثالياً لسيناريوهات الإغاثة السريعة حيث الوقت عامل حاسم.'
    )
    
    add_page_break()
    
    # ══════════════════════════════════════════════════════
    # SECTION 2: أهداف المشروع
    # ══════════════════════════════════════════════════════
    
    add_heading('٢. أهداف المشروع', level=1)
    
    objectives = [
        'أتمتة عملية تسجيل المتطوعين وإلغاء الاعتماد على واتساب والطرق اليدوية',
        'تقليل الوقت المطلوب للتسجيل من دقائق إلى ثوانٍ',
        'منع التسجيل المكرر لنفس المتطوع في نفس المهمة',
        'توفير تأكيد صوتي لكل متطوع لضمان المساءلة والمصداقية',
        'تمكين المدير من التحكم الكامل في المهمات (فتح/قفل التسجيل، تعديل التفاصيل، إغلاق المهمة نهائياً)',
        'توفير لوحة تحكم شاملة للمدير لمتابعة التسجيلات لحظة بلحظة',
        'دعم التصدير بصيغة CSV لتسهيل التنسيق مع الجهات المعنية',
        'توفير نظام قائمة انتظار ذكي عند اكتمال سعة المهمة',
        'دعم التسجيل المؤقت بدون رقم عضوية في الحالات الاستثنائية',
        'حفظ بيانات المتطوعين للاستخدام المستقبلي وتسجيل أسرع في المرة القادمة',
    ]
    
    for obj in objectives:
        add_bullet('●  ' + obj)
    
    add_page_break()
    
    # ══════════════════════════════════════════════════════
    # SECTION 3: المشكلة
    # ══════════════════════════════════════════════════════
    
    add_heading('٣. المشكلة التي يحلها المشروع', level=1)
    
    add_rtl_para(
        'كانت الجمعية المصرية الهلال الأحمر — فرع المنيا تعتمد بشكل كامل على تطبيقات المراسلة (واتساب) '
        'لتنسيق تسجيل المتطوعين في المهمات. هذا الأسلوب يعاني من عدة مشاكل جوهرية:'
    )
    
    problems = [
        ('التأخير في الرد:', 'يحتاج المدير للرد على كل متطوع يدوياً، مما يستغرق ساعات'),
        ('التسجيل المكرر:', 'لا يوجد mechanism لمنع نفس المتطوع من التسجيل عدة مرات'),
        ('فقدان البيانات:', 'قد تُحذف المحادثات بالخطأ أو تضيع بين رسائل كثيرة'),
        ('غياب التأكيد الصوتي:', 'لا يوجد دليل مسجل على موافقة المتطوع على المشاركة'),
        ('صعوبة التصدير:', 'لا يمكن استخراج قائمة مرتّبة من رسائل واتساب'),
        ('عدم التنظيم:', 'البيانات مبعثرة في محادثات مختلفة وصعبة تجميعها'),
    ]
    
    for title, desc in problems:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        p.paragraph_format.space_after = Pt(6)
        run_title = p.add_run(f'■  {title}  ')
        run_title.font.name = 'Arial'
        run_title.font.size = Pt(12)
        run_title.font.bold = True
        run_title.font.color.rgb = RED
        run_desc = p.add_run(desc)
        run_desc.font.name = 'Arial'
        run_desc.font.size = Pt(12)
        run_desc.font.color.rgb = DARK_GRAY
    
    add_page_break()
    
    # ══════════════════════════════════════════════════════
    # SECTION 4: الحل المقترح
    # ══════════════════════════════════════════════════════
    
    add_heading('٤. الحل المقترح', level=1)
    
    add_rtl_para(
        'يقدم نظام التسجيل الذكي حلولاً شاملة لجميع المشاكل المذكورة أعلاه من خلال:'
    )
    
    solutions = [
        'منصة ويب موحدة: جميع التسجيلات تتم عبر رابط واحد مختصر',
        'التحقق التلقائي: يتم التحقق من رقم العضوية تلقائياً عبر قاعدة البيانات',
        'منع التسجيل المكرر: يمنع النظام تسجيل نفس المتطوع مرتين في نفس المهمة',
        'التأكيد الصوتي الإلزامي: لا يمكن إكمال التسجيل بدون تسجيل صوتي',
        'لوحة تحكم شاملة: المدير يراقب كل شيء في مكان واحد',
        'تصدير فوري: يمكن تصدير جميع التسجيلات بصيغة CSV في ثانية',
        'نظام قائمة انتظار: عند اكتمال السعة، يُضاف المتطوع للقائمة تلقائياً',
        'حفظ البيانات: يمكن حفظ بيانات المتطوع لتسهيل التسجيل المستقبلي',
    ]
    
    for sol in solutions:
        add_bullet('●  ' + sol)
    
    # Flow image
    add_image("flow.png", width_mm=150)
    
    add_page_break()
    
    # ══════════════════════════════════════════════════════
    # SECTION 5: المستخدمون المستهدفون
    # ══════════════════════════════════════════════════════
    
    add_heading('٥. المستخدمون المستهدفون', level=1)
    
    # Admin subsection
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = p.add_run('المدير (Admin)')
    run.font.name = 'Arial'
    run.font.size = Pt(16)
    run.font.bold = True
    run.font.color.rgb = RED
    
    admin_caps = [
        'إنشاء مهمات جديدة وتحديد تفاصيلها (الاسم، الوصف، التاريخ، الموقع، السعة)',
        'فتح وقفل التسجيل للمهمات',
        'تعديل تفاصيل المهمات في أي وقت',
        'إغلاق المهمات نهائياً',
        'مراقبة التسجيلات لحظة بلحظة',
        'تصدير البيانات بصيغة CSV',
        'إلغاء تسجيل متطوع محدد',
    ]
    for cap in admin_caps:
        add_bullet('●  ' + cap)
    
    doc.add_paragraph()
    
    # Volunteer subsection
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = p.add_run('المتطوع (Volunteer)')
    run.font.name = 'Arial'
    run.font.size = Pt(16)
    run.font.bold = True
    run.font.color.rgb = GOLD
    
    vol_caps = [
        'تسجيل اسمه في المهمة عبر الرابط المختصر',
        'إدخال بياناته (رقم العضوية، الاسم، رقم الهاتف)',
        'تسجيل تأكيد صوتي',
        'عرض حالة التسجيل (مؤكد أو في قائمة الانتظار)',
        'حفظ بياناته للاستخدام المستقبلي',
        'التسجيل المؤقت بدون رقم عضوية (في حالات الطوارئ)',
    ]
    for cap in vol_caps:
        add_bullet('●  ' + cap)
    
    add_page_break()
    
    # ══════════════════════════════════════════════════════
    # SECTION 6: الميزات الرئيسية
    # ══════════════════════════════════════════════════════
    
    add_heading('٦. الميزات الرئيسية', level=1)
    
    # 6.1
    add_heading('٦.١ إدارة المهمات (Admin Dashboard)', level=2)
    
    admin_features = [
        'إنشاء مهمات جديدة بسهولة مع جميع التفاصيل المطلوبة',
        'لوحة تحكم متكاملة بثلاث تبويبات: نظرة عامة، تعديل التفاصيل، الإعدادات',
        'فتح وقفل التسجيل فوري (بدون تأخير)',
        'تعديل تفاصيل المهمة (الاسم، الوصف، الموقع، السعة، التواريخ)',
        'إغلاق المهمة نهائياً مع تأكيد',
        'متابعة التسجيلات الحية كل ٣ ثوانٍ',
        'تصدير البيانات بصيغة CSV مع دعم العربي (UTF-8 BOM)',
        'إلغاء تسجيل متطوع محدد مع تحديث تلقائي للقائمة',
    ]
    for feat in admin_features:
        add_bullet('●  ' + feat)
    
    # 6.2
    add_heading('٦.٢ تسجيل المتطوعين (Registration Flow)', level=2)
    
    reg_features = [
        'واجهة مبسطة وسريعة (أقل من ٢٠ ثانية للخبراء)',
        'التحقق التلقائي من رقم العضوية',
        'منع التسجيل المكرر لنفس المتطوع في نفس المهمة',
        'تأكيد صوتي إلزامي عبر الميكروفون',
        'عرض مباشر لجدول التسجيلات (يتحدث كل ٣ ثوانٍ)',
        'رسالة نجاح فورية مع خيار تسجيل متطوع آخر',
        'دعم التسجيل المؤقت بدون رقم عضوية',
        'حفظ بيانات المتطوع للاستخدام المستقبلي',
    ]
    for feat in reg_features:
        add_bullet('●  ' + feat)
    
    # Mobile mockup image
    add_image("mobile.png", width_mm=80)
    
    # 6.3
    add_heading('٦.٣ نظام القائمة الذكي', level=2)
    
    queue_features = [
        'عند اكتمال السعة، يُضاف المتطوع للقائمة تلقائياً',
        'عند إلغاء تسجيل متطوع، يتم ترقية أول متطوع في القائمة تلقائياً',
        'عرض المتطوعين المسجلين مع رقم ترتيبهم في القائمة',
        'رسالة واضحة للمتطوع عن حالته (مؤكد أو في قائمة الانتظار)',
    ]
    for feat in queue_features:
        add_bullet('●  ' + feat)
    
    # 6.4
    add_heading('٦.٤ حفظ البيانات السريع', level=2)
    
    save_features = [
        'حفظ بيانات المتطوع (رقم العضوية، الاسم، الهاتف) للاستخدام المستقبلي',
        'ملء تلقائي للبيانات عند التسجيل في المرة القادمة',
        'شاشة نجاح واضحة بعد الحفظ',
        'بيانات محفوظة بشكل آمن في قاعدة البيانات',
    ]
    for feat in save_features:
        add_bullet('●  ' + feat)
    
    add_page_break()
    
    # ══════════════════════════════════════════════════════
    # SECTION 7: البنية التحتية التقنية
    # ══════════════════════════════════════════════════════
    
    add_heading('٧. البنية التحتية التقنية', level=1)
    
    add_rtl_para(
        'بُني النظام على منصة Cloudflare الكاملة، مما يوفر أداءً عالياً وتكلفنة وسهولة في النشر:'
    )
    
    # Architecture image
    add_image("architecture.png", width_mm=150)
    
    # 7.1 Backend
    add_heading('٧.١ الخادم (Backend)', level=2)
    
    backend = [
        'Cloudflare Workers: بيئة تشغيل السيرفر بدون خوادم تقليدية',
        'Hono Framework: إطار عمل خفيف وسريع لبناء APIs',
        'TypeScript: لغة البرمجة مع فحص الأنواع الصارم',
        'D1 Database: قاعدة بيانات SQLite موزعة عالمياً',
        'R2 Storage: تخزين الملفات الصوتية بدون تكاليف خروج بيانات',
    ]
    for item in backend:
        add_bullet('●  ' + item)
    
    # 7.2 Frontend
    add_heading('٧.٢ الواجهة الأمامية (Frontend)', level=2)
    
    frontend = [
        'React: مكتبة بناء واجهات المستخدم التفاعلية',
        'Vite: أداة بناء سريعة للتطوير',
        'TailwindCSS: إطار عمل CSS للتصميم الحديث',
        'Cloudflare Pages: استضافة الواجهة الأمامية',
    ]
    for item in frontend:
        add_bullet('●  ' + item)
    
    # 7.3 Why Cloudflare
    add_heading('٧.٣ لماذا Cloudflare؟', level=2)
    
    cf_reasons = [
        'الأداء العالي: السيرفر يعمل على أقرب نقطة للمستخدم عالمياً',
        'التكلفة المنخفضة: الخطة المجانية تكفي لـ MVP',
        'سهولة النشر: نشر تلقائي بضغطة زر',
        'الأمان: حماية DDoS مدمجة',
        'الموثوقية: ٩٩.٩٪ وقت تشغيل',
        'التوسع التلقائي: يتعامل مع أي حركة مرور بدون إعداد إضافي',
    ]
    for item in cf_reasons:
        add_bullet('●  ' + item)
    
    # Tech stack table
    doc.add_paragraph()
    add_table(
        headers=['المكون', 'التقنية', 'الدور'],
        rows=[
            ['السيرفر', 'Cloudflare Workers + Hono', 'استضافة APIs والمصادقة'],
            ['قاعدة البيانات', 'D1 (SQLite)', 'تخزين البيانات والمهمات'],
            ['التخزين', 'R2 Object Storage', 'ملفات التأكيد الصوتي'],
            ['الواجهة', 'React + Vite + TailwindCSS', 'واجهة المستخدم التفاعلية'],
            ['الاستضافة', 'Cloudflare Pages', 'نشر الواجهة الأمامية'],
            ['البناء', 'TypeScript', 'برمجة آمنة ومحددة الأنواع'],
        ]
    )
    
    add_page_break()
    
    # ══════════════════════════════════════════════════════
    # SECTION 8: هيكل قاعدة البيانات
    # ══════════════════════════════════════════════════════
    
    add_heading('٨. هيكل قاعدة البيانات', level=1)
    
    add_rtl_para(
        'تتكون قاعدة البيانات من ١٠ جداول رئيسية تغطي جميع احتياجات النظام:'
    )
    
    add_table(
        headers=['الجدول', 'الوصف', 'الاستخدام الرئيسي'],
        rows=[
            ['admin_users', 'بيانات المديرين', 'تسجيل الدخول والصلاحيات'],
            ['admin_sessions', 'جلسات المدير', 'معرف الجلسة والانتهاء'],
            ['missions', 'المهمات', 'جميع تفاصيل المهمة'],
            ['registrations', 'التسجيلات', 'بيانات تسجيل المتطوعين'],
            ['audio_confirmations', 'التأكيدات الصوتية', 'ملفات التأكيد الصوتي'],
            ['volunteers', 'المتطوعون', 'بيانات المتطوعين المحفوظة'],
            ['quick_profiles', 'الملفات السريعة', 'بيانات محفوظة للاستخدام السريع'],
            ['registration_attempts', 'محاولات التسجيل', 'تتبع محاولات التسجيل'],
            ['audit_log', 'سجل التدقيق', 'تتبع جميع العمليات'],
            ['migrations', 'التحديثات', 'تتبع تحديثات قاعدة البيانات'],
        ]
    )
    
    add_page_break()
    
    # ══════════════════════════════════════════════════════
    # SECTION 9: سير العمل الرئيسي
    # ══════════════════════════════════════════════════════
    
    add_heading('٩. سير العمل الرئيسي', level=1)
    
    # 9.1 Admin workflow
    add_heading('٩.١ سير عمل المدير', level=2)
    
    admin_steps = [
        'تسجيل الدخول إلى لوحة التحكم',
        'إنشاء مهمة جديدة مع تحديد جميع التفاصيل',
        'نسخ رابط التسجيل وإرساله للمتطوعين',
        'متابعة التسجيلات الحية في لوحة التحكم',
        'فتح/قفل التسجيل حسب الحاجة',
        'تعديل التفاصيل إذا لزم الأمر',
        'تصدير البيانات بصيغة CSV عند الانتهاء',
        'إغلاق المهمة نهائياً بعد الانتهاء',
    ]
    for step in admin_steps:
        add_numbered(step)
    
    doc.add_paragraph()
    
    # 9.2 Volunteer workflow
    add_heading('٩.٢ سير عمل المتطوع', level=2)
    
    vol_steps = [
        'فتح رابط التسجيل (QR Code أو رابط نصي)',
        'إدخال رقم العضوية والاسم ورقم الهاتف',
        'الضغط على زر التسجيل',
        'تسجيل تأكيد صوتي قصير',
        'عرض رسالة النجاح مع حالة التسجيل',
        'اختيار حفظ البيانات للمرة القادمة (اختياري)',
    ]
    for step in vol_steps:
        add_numbered(step)
    
    add_page_break()
    
    # ══════════════════════════════════════════════════════
    # SECTION 10: واجهة المستخدم
    # ══════════════════════════════════════════════════════
    
    add_heading('١٠. واجهة المستخدم', level=1)
    
    add_rtl_para('تم تصميم واجهة المستخدم لتكون:')
    
    ui_features = [
        'متوافقة مع الأجهزة المحمولة (Mobile-First): تعمل بشكل ممتاز على الهواتف',
        'سريعة التحميل: أقل من ثانية واحدة للتحميل الأولي',
        'سهلة الاستخدام: تصميم بديهي لا يحتاج تدريب',
        'عربية بالكامل: جميع النصوص والأزرار بالعربية',
        'حديثة: تصميم عصري بألوان متناسقة',
        'متجاوبة: تتكيف مع جميع أحجام الشاشات',
    ]
    for feat in ui_features:
        add_bullet('●  ' + feat)
    
    add_page_break()
    
    # ══════════════════════════════════════════════════════
    # SECTION 11: الأمان والحماية
    # ══════════════════════════════════════════════════════
    
    add_heading('١١. الأمان والحماية', level=1)
    
    security = [
        'مصادقة المدير: جلسات مؤقتة مع انتهاء صلاحية ٢٤ ساعة',
        'منع التسجيل المكرر: يتم التحقق من رقم العضوية لكل مهمة',
        'حماية تسجيلات الدخول: كلمات المرور مشفرة بـ bcrypt',
        'الأمان الناقل: جميع الاتصالات عبر HTTPS',
        'حماية API: جميع endpoints محمية بالمصادقة',
        'سجل التدقيق: جميع العمليات مسجلة للتدقيق',
        'حماية R2: التخزين السحابي مع صلاحيات صارمة',
        'التحقق من الإدخال: جميع المدخلات مُsanitized بصرامة',
    ]
    for item in security:
        add_bullet('●  ' + item)
    
    add_page_break()
    
    # ══════════════════════════════════════════════════════
    # SECTION 12: خطة النشر
    # ══════════════════════════════════════════════════════
    
    add_heading('١٢. خطة النشر والتكاليف', level=1)
    
    add_heading('١٢.١ المتطلبات الأولية', level=2)
    
    prereqs = [
        'حساب Cloudflare مجاني',
        'Node.js ١٨+ مثبت على جهاز التطوير',
        'npm أو yarn',
        'حساب GitHub لتخزين الكود',
    ]
    for item in prereqs:
        add_bullet('●  ' + item)
    
    add_heading('١٢.٢ خطوات النشر', level=2)
    
    deploy_steps = [
        'إنشاء حساب Cloudflare وتفعيل D1 و R2',
        'استنساخ المشروع من GitHub',
        'تثبيت التبعيات: npm install',
        'إعداد قاعدة البيانات: npx wrangler d1 migrations apply',
        'نشر الخادم: npx wrangler deploy',
        'نشر الواجهة: npx wrangler pages deploy dist',
        'إضافة مدير: npx wrangler d1 execute',
    ]
    for step in deploy_steps:
        add_numbered(step)
    
    add_heading('١٢.٣ التكلفة المتوقعة', level=2)
    
    add_table(
        headers=['المكون', 'الحد المجاني', 'الملاحظات'],
        rows=[
            ['Cloudflare Workers', '١٠٠,٠٠٠ طلب/يوم', 'يكفي لـ MVP'],
            ['D1 Database', '٥ جيجابايت', 'قاعدة بيانات SQLite'],
            ['R2 Storage', '١٠ جيجابايت', 'تخزين ملفات صوتية'],
            ['Pages', '٥٠٠ طلب/شهر', 'استضافة الواجهة'],
            ['الإجمالي', 'مجاني تماماً', 'للمشاريع الصغيرة'],
        ]
    )
    
    add_page_break()
    
    # ══════════════════════════════════════════════════════
    # SECTION 13: المستقبل
    # ══════════════════════════════════════════════════════
    
    add_heading('١٣. المستقبل والتحسينات المقترحة', level=1)
    
    future = [
        'إشعارات فورية: إرسال إشعارات للمتطوعين عبر SMS أو Email',
        'خريطة التوزيع: عرض المتطوعين على خريطة تفاعلية',
        'تقارير متقدمة: إحصائيات ورسوم بيانية للمدير',
        'ترجمة متعددة: دعم الإنجليزية بالإضافة للعربية',
        'تطبيق موبايل: تطبيق أصلي لـ iOS و Android',
        'تكامل مع أنظمة أخرى: ربط مع أنظمة الجمعية الموجودة',
        'نظام التقييم: تقييم المتطوعين بعد كل مهمة',
        'التنسيق التلقائي: جدولة المهمات تلقائياً',
        'التحقق من الهوية: ربط مع قواعد بيانات الجمعية المركزية',
        'نظام الصلاحيات: مستويات متعددة للمديرين',
    ]
    for item in future:
        add_bullet('●  ' + item)
    
    add_page_break()
    
    # ══════════════════════════════════════════════════════
    # SECTION 14: الخاتمة
    # ══════════════════════════════════════════════════════
    
    add_heading('١٤. الخاتمة', level=1)
    
    add_rtl_para(
        'يُمثل نظام التسجيل الذكي للمهمات خطوة نوعية في تحديث عملية إدارة المتطوعين للجمعية المصرية الهلال الأحمر — فرع المنيا. '
        'من خلال الاعتماد على تقنيات الحوسبة السحابية الحديثة، يوفر النظام أداءً عالياً وتكلفنة وسهولة في الاستخدام والصيانة.'
    )
    
    add_rtl_para(
        'يتميز النظام ببساطة تصميمه وقوة إمكانياته، مما يجعله مناسباً للتطبيق الفعلي في مهمات الجمعية الحقيقية. '
        'مع وجود خطة واضحة للتحسينات المستقبلية، يبقى النظام قابلاً للتوسع والتطوير ليواكب احتياجات الجمعية المتنامية.'
    )
    
    add_rtl_para(
        'نسأل الله أن يكون هذا النظام نافعاً لخدمة humanity ودعم جهود الإغاثية للجمعية المصرية الهلال الأحمر.'
    )
    
    # Final decorative line
    add_colored_line('F39C12')
    
    # ── References ──────────────────────────────────────
    add_heading('المراجع والموارد', level=1)
    
    refs = [
        'مستودع المشروع على GitHub: https://github.com/yossefe532/red-crescent-minya',
        'وثائق Cloudflare Workers: https://developers.cloudflare.com/workers/',
        'وثائق D1 Database: https://developers.cloudflare.com/d1/',
        'وثائق React: https://react.dev/',
        'وثائق Hono: https://hono.dev/',
        'وثائق TailwindCSS: https://tailwindcss.com/',
    ]
    for ref in refs:
        add_bullet('●  ' + ref)
    
    # ── Save ────────────────────────────────────────────
    out_path = "D:/harmes jop/red-crescent-minya/تقرير-مشروع-التسجيل-الذكي-احترافي.docx"
    doc.save(out_path)
    print(f"✅ Report saved to: {out_path}")
    return out_path

if __name__ == '__main__':
    create_report()
