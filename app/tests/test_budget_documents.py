"""Synthetic fixtures only: these tests never read .env or contact Atlas/email."""
import base64
import io
import json
import unittest
import urllib.request
import zipfile
from datetime import datetime
from openpyxl import Workbook, load_workbook
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

from finance_documents import preview_document, export_workbook, DocumentError, MAX_FILE_BYTES
from server import create_user, validate_finance_data_patch, MongoStore
import test_server as fixtures

CSV = b"Date,Description,Debit,Credit\n01/10/2026,Groceries,1250,\n02/10/2026,Salary,,60000\n"

def pdf_fixture(text):
    book = PdfWriter()
    page = book.add_blank_page(1000, 600)
    font = DictionaryObject({NameObject("/Type"):NameObject("/Font"),
        NameObject("/Subtype"):NameObject("/Type1"),NameObject("/BaseFont"):NameObject("/Courier")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"):DictionaryObject({NameObject("/F1"):book._add_object(font)})})
    commands = ["BT /F1 10 Tf 20 550 Td 15 TL"]
    for line in text.splitlines():
        commands.extend(["("+line.replace("\\","\\\\").replace("(","\\(").replace(")","\\)")+") Tj","T*"])
    commands.append("ET")
    stream=DecodedStreamObject();stream.set_data("\n".join(commands).encode())
    page[NameObject("/Contents")]=book._add_object(stream)
    output=io.BytesIO();book.write(output);return output.getvalue()

class DocumentTests(unittest.TestCase):
    def test_csv_preserves_dates_debits_credits_and_missing_amounts(self):
        entries=preview_document("statement.csv",CSV)["entries"]
        self.assertEqual([(e["date"],e["type"],e["amount"]) for e in entries],
                         [("2026-10-01","expense",1250),("2026-10-02","income",60000)])
        bad=preview_document("bad.csv",b"Date,Type,Amount\n31/02/2026,expense,\n")["entries"][0]
        self.assertEqual(bad["date"],"")
        self.assertIsNone(bad["amount"])
        self.assertTrue(bad["issues"])

    def test_ambiguous_direction_is_not_guessed(self):
        for data in [b"Date,Amount\n01/10/2026,300\n",
                     b"Date,Debit,Credit\n01/10/2026,400,300\n",
                     b"Date,Debit,Credit\n01/10/2026,unknown,300\n"]:
            self.assertEqual(preview_document("a.csv",data)["entries"][0]["type"],"")

    def test_date_order_is_explicit(self):
        data=b"Date,Type,Amount\n03/04/2026,expense,100\n"
        self.assertEqual(preview_document("a.csv",data)["entries"][0]["date"],"2026-04-03")
        self.assertEqual(preview_document("a.csv",data,"month-first")["entries"][0]["date"],"2026-03-04")

    def test_workbook_reads_dates_but_never_executes_formulas(self):
        book=Workbook();sheet=book.active
        sheet.append(["Date","Type","Amount","Description"])
        sheet.append([datetime(2026,10,1),"expense",150,"=HYPERLINK('bad')"])
        sheet.append([datetime(2026,10,2),"expense","=100+50","Formula amount"])
        output=io.BytesIO();book.save(output)
        entries=preview_document("a.xlsx",output.getvalue())["entries"]
        self.assertEqual(entries[0]["amount"],150)
        self.assertIsNone(entries[1]["amount"])

    def test_docx_tables_and_unsafe_xml(self):
        def document(xml):
            output=io.BytesIO()
            with zipfile.ZipFile(output,"w") as z:z.writestr("word/document.xml",xml)
            return output.getvalue()
        cells=lambda values:"<w:tr>"+"".join("<w:tc><w:p><w:r><w:t>"+v+"</w:t></w:r></w:p></w:tc>" for v in values)+"</w:tr>"
        xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>'+cells(["Date","Type","Amount"])+cells(["01/10/2026","expense","500"])+"</w:tbl></w:body></w:document>"
        self.assertEqual(preview_document("a.docx",document(xml))["entries"][0]["amount"],500)
        with self.assertRaises(DocumentError):
            preview_document("a.docx",document('<!DOCTYPE x [<!ENTITY leak SYSTEM "file:///secret">]><x>&leak;</x>'))

    def test_pdf_preserves_blank_debit_column(self):
        line=lambda a,b,c,d:f"{a:<15}{b:<25}{c:<15}{d:<15}"
        data=pdf_fixture("\n".join([line("Date","Description","Debit","Credit"),
                                  line("01/10/2026","Groceries","500",""),
                                  line("02/10/2026","Salary","","50000")]))
        entries=preview_document("statement.pdf",data)["entries"]
        self.assertEqual([(e["type"],e["amount"]) for e in entries],[("expense",500),("income",50000)])

    def test_scan_empty_unsupported_oversized_and_balance_only_are_rejected(self):
        book=PdfWriter();book.add_blank_page(200,200);output=io.BytesIO();book.write(output)
        for name,data in [("scan.pdf",output.getvalue()),("a.png",b"image"),("big.csv",b"x"*(MAX_FILE_BYTES+1)),
                          ("a.csv",b"Date,Balance\n01/10/2026,50000\n")]:
            with self.assertRaises(DocumentError):preview_document(name,data)

    def test_export_is_organised_filters_month_and_escapes_formulas(self):
        entries=[{"id":"1","date":"2026-10-03","type":"expense","category":"Personal","amount":250,"note":"=1+1"},
                 {"id":"2","date":"2026-10-01","type":"income","category":"Salary","amount":1000,"note":"Salary"},
                 {"id":"3","date":"2026-09-01","type":"expense","category":"Other","amount":999,"note":"Old"}]
        book=load_workbook(io.BytesIO(export_workbook(entries,"2026-10")))
        self.assertEqual(book.sheetnames,["Entries","Summary"])
        self.assertEqual(book.active.title,"Entries")
        self.assertEqual(book["Summary"]["B4"].value,750)
        sheet=book["Entries"]
        self.assertEqual(sheet.max_row,3)
        self.assertEqual(list(sheet.values),[
            ("Date","Type","Category","Note / description","Income (INR)","Expense (INR)"),
            (datetime(2026,10,1),"Income","Salary","Salary",1000,None),
            (datetime(2026,10,3),"Expense","Personal","=1+1",None,250),
        ])
        all_months=load_workbook(io.BytesIO(export_workbook(entries)))
        self.assertEqual(all_months.active.title,"Entries")
        self.assertEqual(all_months["Entries"].max_row,4)
        self.assertEqual(all_months["Entries"]["A2"].value,datetime(2026,9,1))
        self.assertEqual(all_months["Entries"]["C2"].value,"Other")
        self.assertEqual(sheet["D3"].value,"=1+1")
        self.assertEqual(sheet["D3"].data_type,"s")
        self.assertEqual(sheet.freeze_panes,"A2")
        self.assertEqual(sheet.auto_filter.ref,"A1:F3")

class GoalSchemaTests(unittest.TestCase):
    def goal(self):
        return {"id":"goal-1","name":"Car","category":"car","createdAt":"2026-11-01T00:00:00Z",
                "updatedAt":"2026-11-01T00:00:00Z","profile":{"includeGoal":True,"goalType":"car",
                "monthlyEssentialExpenses":1200,"essentialItems":[{"name":"Rent","amount":1200}]}}

    def test_goal_and_item_validation(self):
        goal=self.goal()
        self.assertIsNone(validate_finance_data_patch({"goalPlans":[goal]})[1])
        for change in [{"category":"wedding"},{"profile":{"essentialItems":[{"name":"x","amount":float("nan")}]}},
                       {"updatedAt":"yesterday"},{"userId":"another-user"}]:
            self.assertIsNotNone(validate_finance_data_patch({"goalPlans":[{**goal,**change}]})[1])
        self.assertIsNotNone(validate_finance_data_patch({"goalPlans":[goal,goal]})[1])
        profile=goal["profile"]
        self.assertIsNotNone(validate_finance_data_patch({"plannerProfile":{**profile,"monthlyEssentialExpenses":500}})[1])

    def test_mongo_goals_are_kept_under_the_session_account(self):
        class Collection:
            def __init__(self):self.docs={}
            def find_one(self,q):return self.docs.get(q["_id"])
            def update_one(self,q,u,upsert=False):
                doc=self.docs.setdefault(q["_id"],{"_id":q["_id"]})
                doc.update(u.get("$set",{}))
        store=object.__new__(MongoStore);store.finance_data=Collection()
        store.update_finance_data("owner-a",{"goalPlans":[self.goal()]})
        store.update_finance_data("owner-b",{"goalPlans":[]})
        self.assertEqual(len(store.get_finance_data("owner-a")["goalPlans"]),1)
        self.assertEqual(store.get_finance_data("owner-b")["goalPlans"],[])

class DocumentApiTests(unittest.TestCase):
    setUp=fixtures.AccountServerTests.setUp
    tearDown=fixtures.AccountServerTests.tearDown
    request=fixtures.AccountServerTests.request
    valid_fields=fixtures.AccountServerTests.valid_fields

    def login(self,email):
        user=create_user(self.database_file,self.valid_fields(email=email),email_verified=True)
        self.assertEqual(self.request("/api/login","POST",{"email":email,"password":"long-enough-example-123"})[0],200)
        return user["id"]

    def test_import_requires_session_and_owner_and_does_not_save(self):
        payload={"filename":"a.csv","content":base64.b64encode(CSV).decode()}
        self.assertEqual(self.request("/api/budget/import-preview","POST",payload)[0],401)
        owner=self.login("import@example.com")
        self.assertEqual(self.request("/api/budget/import-preview","POST",payload,owner="someone-else")[0],401)
        status,result=self.request("/api/budget/import-preview","POST",payload,owner=owner)
        self.assertEqual(status,200)
        self.assertEqual(len(result["entries"]),2)
        self.assertEqual(self.request("/api/finance-data")[1]["data"],{})
        self.assertEqual(self.request("/api/budget/import-preview","POST",payload,origin="https://other.test")[0],403)

    def test_selected_month_export_accepts_each_month_and_keeps_entry_details(self):
        owner = self.login("monthly-export@example.com")
        entries = [
            {"id": str(month), "date": f"2026-{month:02d}-03", "type": "expense",
             "category": "Transport", "note": f"Bus fare {month}", "amount": month * 100}
            for month in range(1, 13)
        ]
        self.assertEqual(self.request("/api/finance-data", "PATCH", {"transactions": entries}, owner=owner)[0], 200)
        for month in range(1, 13):
            with self.subTest(month=month):
                request = urllib.request.Request(
                    self.base_url + f"/api/budget/export?month=2026-{month:02d}",
                    headers={"X-Finance-Owner": str(owner)},
                )
                with self.client.open(request) as response:
                    self.assertEqual(response.status, 200)
                    book = load_workbook(io.BytesIO(response.read()))
                self.assertEqual(book.active.title, "Entries")
                self.assertEqual(list(book["Entries"].values)[1:], [
                    (datetime(2026, month, 3), "Expense", "Transport", f"Bus fare {month}", None, month * 100)
                ])

    def test_export_rejects_invalid_months(self):
        from urllib.parse import quote
        owner = self.login("invalid-month@example.com")
        for month in ["2026-00", "2026-13", "2026-1", "not-a-month", "2026-10-01", "2026-10extra"]:
            with self.subTest(month=month):
                status, result = self.request("/api/budget/export?month=" + quote(month), owner=owner)
                self.assertEqual(status, 400)
                self.assertEqual(result["error"], "Choose a valid month.")

    def test_goals_and_entries_survive_new_login_and_export_is_scoped(self):
        owner=self.login("first@example.com")
        entry={"id":"entry","type":"expense","date":"2026-10-01","category":"Other","note":"Private","amount":120}
        data={"transactions":[entry],"goalPlans":[GoalSchemaTests().goal()]}
        self.assertEqual(self.request("/api/finance-data","PATCH",data,owner=owner)[0],200)
        request=urllib.request.Request(self.base_url+"/api/budget/export",headers={"X-Finance-Owner":str(owner)})
        with self.client.open(request) as response:
            self.assertEqual(response.headers["Cache-Control"],"no-store")
            book=load_workbook(io.BytesIO(response.read()))
            self.assertEqual(book["Entries"]["D2"].value,"Private")
        self.request("/api/logout","POST",{})
        other=self.login("second@example.com")
        self.assertEqual(self.request("/api/finance-data")[1]["data"],{})
        self.assertEqual(self.request("/api/budget/export",owner=owner)[0],401)
        self.request("/api/logout","POST",{})
        self.request("/api/login","POST",{"email":"first@example.com","password":"long-enough-example-123"})
        self.assertEqual(self.request("/api/finance-data")[1]["data"],data)
