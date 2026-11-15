// Ready-made, hand-written VBA blocks for the Excel macro builder. Each block brings its sheets (with sample data),
// its settings and its macros. Macros find their columns by the header text in row 1, so columns can be renamed in
// the spec only where the block says a header is free to change (extra columns are always fine).

export const CORE = `Option Explicit
' ===== vivo BI macro helpers (used by every macro in this file) =====

Public Function Setting(ByVal key As String, Optional ByVal def As String = "") As String
    Dim ws As Worksheet, r As Long
    Setting = def
    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets("Settings")
    On Error GoTo 0
    If ws Is Nothing Then Exit Function
    For r = 2 To ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
        If LCase(Trim(CStr(ws.Cells(r, 1).Value))) = LCase(Trim(key)) Then
            If Trim(CStr(ws.Cells(r, 2).Value)) <> "" Then Setting = Trim(CStr(ws.Cells(r, 2).Value))
            Exit Function
        End If
    Next r
End Function

Public Sub SetSetting(ByVal key As String, ByVal v As String)
    Dim ws As Worksheet, r As Long
    Set ws = ThisWorkbook.Worksheets("Settings")
    For r = 2 To ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
        If LCase(Trim(CStr(ws.Cells(r, 1).Value))) = LCase(Trim(key)) Then ws.Cells(r, 2).Value = v: Exit Sub
    Next r
End Sub

Public Function ColOf(ByVal ws As Worksheet, ByVal header As String) As Long
    Dim c As Long, last As Long
    last = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
    For c = 1 To last
        If LCase(Trim(CStr(ws.Cells(1, c).Value))) = LCase(Trim(header)) Then
            ColOf = c
            Exit Function
        End If
    Next c
    ColOf = 0
End Function

Public Function NeedCol(ByVal ws As Worksheet, ByVal header As String) As Long
    NeedCol = ColOf(ws, header)
    If NeedCol = 0 Then Err.Raise vbObjectError + 513, "vivo BI", "Column """ & header & """ is missing in row 1 of sheet """ & ws.Name & """."
End Function

Public Function LastRow(ByVal ws As Worksheet, Optional ByVal col As Long = 1) As Long
    LastRow = ws.Cells(ws.Rows.Count, col).End(xlUp).Row
End Function

Public Function LastDataRow(ByVal ws As Worksheet) As Long
    Dim f As Range
    Set f = ws.Cells.Find(What:="*", LookIn:=xlFormulas, SearchOrder:=xlByRows, SearchDirection:=xlPrevious)
    If f Is Nothing Then LastDataRow = 1 Else LastDataRow = f.Row
End Function

Public Function LastCol(ByVal ws As Worksheet) As Long
    LastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column
End Function

Public Function FolderPath(ByVal p As String) As String
    p = Trim(p)
    If p = "" Then p = ThisWorkbook.Path
    If Right(p, 1) <> Application.PathSeparator Then p = p & Application.PathSeparator
    FolderPath = p
End Function

Public Sub EnsureFolder(ByVal p As String)
    Dim parts() As String, i As Long, cur As String
    p = FolderPath(p)
    If Len(Dir(p, vbDirectory)) > 0 Then Exit Sub
    parts = Split(Left(p, Len(p) - 1), Application.PathSeparator)
    cur = parts(0)
    On Error Resume Next
    For i = 1 To UBound(parts)
        cur = cur & Application.PathSeparator & parts(i)
        If Len(parts(i)) > 0 Then
            If Len(Dir(cur, vbDirectory)) = 0 Then MkDir cur
        End If
    Next i
    On Error GoTo 0
End Sub

Public Function SafeName(ByVal s As String) As String
    Dim bad As Variant
    For Each bad In Array("\\", "/", ":", "*", "?", """", "<", ">", "|", vbCr, vbLf, vbTab)
        s = Replace(s, bad, "-")
    Next bad
    SafeName = Trim(s)
End Function

Public Function FillPattern(ByVal pattern As String, ByVal value As String) As String
    pattern = Replace(pattern, "{value}", value, 1, -1, vbTextCompare)
    pattern = Replace(pattern, "{date}", Format(Date, "yyyy-mm-dd"), 1, -1, vbTextCompare)
    pattern = Replace(pattern, "{month}", Format(Date, "mmm-yyyy"), 1, -1, vbTextCompare)
    pattern = Replace(pattern, "{time}", Format(Now, "hhmm"), 1, -1, vbTextCompare)
    FillPattern = SafeName(pattern)
End Function

' replaces {Any column header} in a text with that row's value, e.g. "Dear {Name}"
Public Function FillRow(ByVal text As String, ByVal ws As Worksheet, ByVal r As Long) As String
    Dim c As Long, h As String
    For c = 1 To LastCol(ws)
        h = Trim(CStr(ws.Cells(1, c).Value))
        If Len(h) > 0 Then text = Replace(text, "{" & h & "}", CStr(ws.Cells(r, c).Text), 1, -1, vbTextCompare)
    Next c
    FillRow = text
End Function

Public Sub LogLine(ByVal action As String, ByVal detail As String, Optional ByVal result As String = "OK")
    Dim ws As Worksheet, r As Long
    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets("Log")
    On Error GoTo 0
    If ws Is Nothing Then Exit Sub
    r = LastRow(ws) + 1
    ws.Cells(r, 1).Value = Now
    ws.Cells(r, 2).Value = action
    ws.Cells(r, 3).Value = detail
    ws.Cells(r, 4).Value = result
End Sub

Public Sub SpeedOn()
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.DisplayAlerts = False
End Sub

Public Sub SpeedOff()
    Application.ScreenUpdating = True
    Application.EnableEvents = True
    Application.DisplayAlerts = True
    Application.StatusBar = False
End Sub

Public Function PickFolder(Optional ByVal title As String = "Choose a folder") As String
    With Application.FileDialog(4)
        .Title = title
        .AllowMultiSelect = False
        If .Show = -1 Then PickFolder = .SelectedItems(1)
    End With
End Function

' button on the Start sheet: choose the folder for the "Folder" setting
Public Sub ChooseFolder()
    Dim p As String
    p = PickFolder("Choose the folder")
    If Len(p) > 0 Then SetSetting "Folder", p: MsgBox "Folder set:" & vbCrLf & p, vbInformation
End Sub

Public Sub ChooseOutputFolder()
    Dim p As String
    p = PickFolder("Choose the output folder")
    If Len(p) > 0 Then SetSetting "Output folder", p: MsgBox "Output folder set:" & vbCrLf & p, vbInformation
End Sub

Public Sub ShowError(ByVal what As String)
    SpeedOff
    MsgBox what & " stopped:" & vbCrLf & Err.Description, vbExclamation, "vivo BI macro"
    LogLine what, "Error", Err.Description
End Sub

' puts real buttons on the Start sheet (runs when the file opens with macros enabled)
Public Sub MakeButtons()
    Dim ws As Worksheet, r As Long, mac As String, shp As Shape, cl As Range, nm As String
    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets("Start")
    On Error GoTo 0
    If ws Is Nothing Then Exit Sub
    For r = 1 To LastRow(ws, 8)
        mac = Trim(CStr(ws.Cells(r, 8).Value))
        If Len(mac) > 0 And mac <> "Macro" Then
            nm = "btn_" & mac
            Set shp = Nothing
            On Error Resume Next
            Set shp = ws.Shapes(nm)
            On Error GoTo 0
            If shp Is Nothing Then
                Set cl = ws.Range(ws.Cells(r, 2), ws.Cells(r, 3))
                Set shp = ws.Shapes.AddShape(5, cl.Left + 2, cl.Top + 2, cl.Width - 4, cl.Height - 4)
                shp.Name = nm
                shp.Fill.ForeColor.RGB = RGB(77, 91, 249)
                shp.Line.Visible = 0
                shp.TextFrame.Characters.Text = CStr(ws.Cells(r, 2).Value)
                shp.TextFrame.Characters.Font.Color = RGB(255, 255, 255)
                shp.TextFrame.Characters.Font.Bold = True
                shp.TextFrame.HorizontalAlignment = xlHAlignCenter
                shp.TextFrame.VerticalAlignment = xlVAlignCenter
                shp.OnAction = mac
                shp.Placement = xlFreeFloating
            End If
        End If
    Next r
End Sub

Public Sub RunFromStart(ByVal r As Long)
    Dim mac As String
    mac = Trim(CStr(ThisWorkbook.Worksheets("Start").Cells(r, 8).Value))
    If Len(mac) > 0 Then Application.Run "'" & ThisWorkbook.Name & "'!" & mac
End Sub
`;

const day = (n) => { const d = new Date(Date.UTC(2026, 9, 1 + n)); return d.toISOString().slice(0, 10); };
const STATES = ["Bihar", "Uttar Pradesh", "Maharashtra", "Karnataka", "Gujarat", "West Bengal", "Rajasthan", "Tamil Nadu"];
const MODELS = ["vivo V60", "vivo Y300", "vivo T4", "vivo Y19s", "vivo X200 FE", "vivo T4 Lite"];
const PRICE = [36999, 21999, 24999, 11999, 54999, 12499];
function salesRows(n) {
  const rows = []; let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    const st = STATES[Math.floor(rnd() * STATES.length)], m = Math.floor(rnd() * MODELS.length), q = 1 + Math.floor(rnd() * 12);
    rows.push([day(Math.floor(rnd() * 45)), st, "DLR" + (10100 + Math.floor(rnd() * 40)), st.split(" ")[0] + " Mobiles " + (1 + Math.floor(rnd() * 9)), MODELS[m], q, q * PRICE[m]]);
  }
  return rows;
}
const SALES_COLS = [["Date", "date", 12], ["State", "text", 16], ["Dealer code", "text", 13], ["Dealer name", "text", 22], ["Model", "text", 15], ["Qty", "number", 8], ["Value", "money", 13]];

export const BLOCKS = {
  rename: {
    name: "Bulk rename files", icon: "🏷️", desc: "List every file in a folder, type new names (or build them with a formula) and rename them all in one click — the extension is kept.",
    sheets: [{ name: "Rename", cols: [["Old name", "text", 34], ["New name", "text", 34], ["Status", "text", 22]], rows: [["Invoice_001.pdf", "Bihar_Invoice_Oct-2026_001.pdf", ""], ["Invoice_002.pdf", "Bihar_Invoice_Oct-2026_002.pdf", ""], ["scan 3.jpg", "DLR10123 shop photo", ""]], note: "Click “List files” to fill Old name from the folder. New name without an extension keeps the old one." }],
    settings: [["Folder", "", "Folder with the files. Empty = the folder of this Excel file. Use the “Choose folder” button."], ["File type", "*.*", "Which files to list, e.g. *.pdf or *.xlsx"]],
    macros: [["ChooseFolder", "📁 Choose folder"], ["ListFiles", "📋 List files"], ["RenameFiles", "🏷️ Rename files"]],
    code: `Option Explicit
Public Sub ListFiles()
    Dim ws As Worksheet, folder As String, f As String, r As Long, cOld As Long
    On Error GoTo fail
    Set ws = ThisWorkbook.Worksheets("Rename")
    folder = FolderPath(Setting("Folder"))
    cOld = NeedCol(ws, "Old name")
    If LastDataRow(ws) > 1 Then ws.Range(ws.Cells(2, 1), ws.Cells(LastDataRow(ws), LastCol(ws))).ClearContents
    r = 2
    f = Dir(folder & Setting("File type", "*.*"))
    Do While Len(f) > 0
        ws.Cells(r, cOld).Value = f
        r = r + 1
        f = Dir()
    Loop
    LogLine "List files", folder, (r - 2) & " files"
    MsgBox (r - 2) & " file(s) listed from:" & vbCrLf & folder & vbCrLf & vbCrLf & "Type the new names, then click Rename files.", vbInformation
    Exit Sub
fail:
    ShowError "List files"
End Sub

Public Sub RenameFiles()
    Dim ws As Worksheet, folder As String, r As Long, last As Long, cOld As Long, cNew As Long, cSt As Long
    Dim oldN As String, newN As String, ok As Long, bad As Long
    On Error GoTo fail
    Set ws = ThisWorkbook.Worksheets("Rename")
    folder = FolderPath(Setting("Folder"))
    cOld = NeedCol(ws, "Old name"): cNew = NeedCol(ws, "New name"): cSt = NeedCol(ws, "Status")
    last = LastRow(ws, cOld)
    If last < 2 Then MsgBox "No files listed yet.", vbInformation: Exit Sub
    If MsgBox("Rename up to " & (last - 1) & " file(s) in:" & vbCrLf & folder, vbYesNo + vbQuestion) <> vbYes Then Exit Sub
    For r = 2 To last
        oldN = Trim(CStr(ws.Cells(r, cOld).Value))
        newN = SafeName(CStr(ws.Cells(r, cNew).Value))
        If Len(oldN) = 0 Or Len(newN) = 0 Then
            ws.Cells(r, cSt).Value = "Skipped"
        Else
            If InStrRev(newN, ".") = 0 And InStrRev(oldN, ".") > 0 Then newN = newN & Mid(oldN, InStrRev(oldN, "."))
            If Len(Dir(folder & oldN)) = 0 Then
                ws.Cells(r, cSt).Value = "Not found": bad = bad + 1
            ElseIf Len(Dir(folder & newN)) > 0 And LCase(newN) <> LCase(oldN) Then
                ws.Cells(r, cSt).Value = "Name already used": bad = bad + 1
            Else
                Err.Clear
                On Error Resume Next
                Name folder & oldN As folder & newN
                If Err.Number = 0 Then
                    ws.Cells(r, cSt).Value = "Renamed": ok = ok + 1
                Else
                    ws.Cells(r, cSt).Value = "Error: " & Err.Description: bad = bad + 1
                End If
                On Error GoTo fail
            End If
        End If
    Next r
    LogLine "Rename files", folder, ok & " renamed, " & bad & " problems"
    MsgBox ok & " file(s) renamed, " & bad & " problem(s). See the Status column.", vbInformation
    Exit Sub
fail:
    ShowError "Rename files"
End Sub
`,
  },

  email: {
    name: "E-mail with attachments (Outlook)", icon: "📧", desc: "One e-mail per row through Outlook — To, CC, subject, a message with {placeholders} from the row, and any number of attachments. Show each mail first or send straight away.",
    sheets: [{ name: "Mail list", cols: [["Name", "text", 18], ["To", "email", 28], ["CC", "email", 24], ["Subject", "text", 30], ["Message", "long", 48], ["Attachments", "path", 44], ["Status", "text", 20]], rows: [["Ravi Kumar", "ravi.kumar@example.com", "", "October scheme payout — {Name}", "Dear {Name},\nPlease find your October scheme payout statement attached.\nRegards,\nvivo BI team", "C:\\Reports\\Payout_Ravi.pdf", ""], ["Meena Singh", "meena.singh@example.com", "manager@example.com", "October scheme payout — {Name}", "Dear {Name},\nPlease find your October scheme payout statement attached.\nRegards,\nvivo BI team", "C:\\Reports\\Payout_Meena.pdf; C:\\Reports\\Scheme_Rules.pdf", ""]], note: "Several attachments: separate the full paths with ;  Use {Any column} in Subject / Message." }],
    settings: [["Send mode", "Display", "Display = open each mail in Outlook to check and send · Send = send straight away"], ["Signature", "", "Optional text added at the end of every message"]],
    macros: [["SendEmails", "📧 Send e-mails"]],
    code: `Option Explicit
Public Sub SendEmails()
    Dim ws As Worksheet, ol As Object, m As Object, r As Long, last As Long, a As Variant
    Dim cTo As Long, cCc As Long, cSub As Long, cBody As Long, cAtt As Long, cSt As Long
    Dim mode As String, sent As Long, bad As Long, miss As String, sig As String
    On Error GoTo fail
    Set ws = ThisWorkbook.Worksheets("Mail list")
    cTo = NeedCol(ws, "To"): cCc = ColOf(ws, "CC"): cSub = NeedCol(ws, "Subject"): cBody = NeedCol(ws, "Message")
    cAtt = ColOf(ws, "Attachments"): cSt = NeedCol(ws, "Status")
    mode = LCase(Setting("Send mode", "Display")): sig = Setting("Signature")
    On Error Resume Next
    Set ol = GetObject(, "Outlook.Application")
    If ol Is Nothing Then Set ol = CreateObject("Outlook.Application")
    On Error GoTo fail
    If ol Is Nothing Then MsgBox "Outlook is not installed or not set up on this computer.", vbExclamation: Exit Sub
    last = LastRow(ws, cTo)
    For r = 2 To last
        If Len(Trim(CStr(ws.Cells(r, cTo).Value))) > 0 And Left(LCase(CStr(ws.Cells(r, cSt).Value)), 4) <> "sent" Then
            miss = ""
            If cAtt > 0 Then
                For Each a In Split(CStr(ws.Cells(r, cAtt).Value), ";")
                    If Len(Trim(a)) > 0 Then
                        If Len(Dir(Trim(a))) = 0 Then miss = miss & " " & Trim(a)
                    End If
                Next a
            End If
            If Len(miss) > 0 Then
                ws.Cells(r, cSt).Value = "Not sent - file missing:" & miss: bad = bad + 1
            Else
                Set m = ol.CreateItem(0)
                m.To = CStr(ws.Cells(r, cTo).Value)
                If cCc > 0 Then m.CC = CStr(ws.Cells(r, cCc).Value)
                m.Subject = FillRow(CStr(ws.Cells(r, cSub).Value), ws, r)
                m.Body = FillRow(CStr(ws.Cells(r, cBody).Value), ws, r) & IIf(Len(sig) > 0, vbCrLf & vbCrLf & sig, "")
                If cAtt > 0 Then
                    For Each a In Split(CStr(ws.Cells(r, cAtt).Value), ";")
                        If Len(Trim(a)) > 0 Then m.Attachments.Add CStr(Trim(a))
                    Next a
                End If
                If mode = "send" Then
                    m.Send
                    ws.Cells(r, cSt).Value = "Sent " & Format(Now, "dd-mmm hh:mm")
                Else
                    m.Display
                    ws.Cells(r, cSt).Value = "Opened in Outlook " & Format(Now, "dd-mmm hh:mm")
                End If
                sent = sent + 1
            End If
        End If
    Next r
    LogLine "E-mails", mode, sent & " done, " & bad & " not sent"
    MsgBox sent & " e-mail(s) " & IIf(mode = "send", "sent", "opened in Outlook") & ", " & bad & " not sent (see Status).", vbInformation
    Exit Sub
fail:
    ShowError "Send e-mails"
End Sub
`,
  },

  whatsapp: {
    name: "WhatsApp messages", icon: "💬", desc: "Opens WhatsApp with each person's message ready (one per row, {placeholders} from the row) — you press Send. WhatsApp does not allow sending or attaching files automatically; the file's folder can be opened for you to drag the file in.",
    sheets: [{ name: "WhatsApp", cols: [["Name", "text", 18], ["Phone", "phone", 15], ["Message", "long", 52], ["File to share", "path", 40], ["Status", "text", 18]], rows: [["Ravi Kumar", "9876543210", "Hi {Name}, your October payout statement is ready. Total: Rs 12,450.", "", ""], ["Meena Singh", "9123456780", "Hi {Name}, the new vivo V60 scheme starts tomorrow. Please check the attached flyer.", "C:\\Flyers\\V60_scheme.jpg", ""]], note: "10-digit numbers get the country code from Settings. Rows with Status starting “Opened” are skipped next time." }],
    settings: [["Country code", "91", "Added in front of 10-digit numbers"], ["Open with", "App", "App = WhatsApp Desktop · Web = WhatsApp Web in the browser"], ["Seconds between", "8", "Time to press Send before the next chat opens"]],
    macros: [["OpenWhatsApp", "💬 Open WhatsApp chats"]],
    code: `Option Explicit
Private Function UrlText(ByVal s As String) As String
    Dim i As Long, ch As String, code As Long, out As String, b() As Byte
    On Error Resume Next
    out = Application.WorksheetFunction.EncodeURL(s)
    If Err.Number = 0 And Len(out) > 0 Then UrlText = out: Exit Function
    On Error GoTo 0
    out = ""
    For i = 1 To Len(s)
        ch = Mid(s, i, 1): code = AscW(ch)
        If (code >= 48 And code <= 57) Or (code >= 65 And code <= 90) Or (code >= 97 And code <= 122) Or ch = "-" Or ch = "_" Or ch = "." Then
            out = out & ch
        ElseIf code < 128 And code >= 0 Then
            out = out & "%" & Right("0" & Hex(code), 2)
        Else
            out = out & "%20"
        End If
    Next i
    UrlText = out
End Function

Public Sub OpenWhatsApp()
    Dim ws As Worksheet, r As Long, last As Long, cPh As Long, cMsg As Long, cFile As Long, cSt As Long
    Dim ph As String, msg As String, url As String, n As Long, waitS As Long, cc As String, f As String
    On Error GoTo fail
    Set ws = ThisWorkbook.Worksheets("WhatsApp")
    cPh = NeedCol(ws, "Phone"): cMsg = NeedCol(ws, "Message"): cFile = ColOf(ws, "File to share"): cSt = NeedCol(ws, "Status")
    cc = Setting("Country code", "91"): waitS = Val(Setting("Seconds between", "8")): If waitS < 3 Then waitS = 3
    last = LastRow(ws, cPh)
    For r = 2 To last
        ph = CStr(ws.Cells(r, cPh).Value)
        ph = Replace(Replace(Replace(Replace(ph, " ", ""), "-", ""), "+", ""), "(", "")
        ph = Replace(ph, ")", "")
        If Len(ph) = 10 Then ph = cc & ph
        If Len(ph) >= 11 And Left(LCase(CStr(ws.Cells(r, cSt).Value)), 6) <> "opened" Then
            msg = FillRow(CStr(ws.Cells(r, cMsg).Value), ws, r)
            If LCase(Setting("Open with", "App")) = "web" Then
                url = "https://web.whatsapp.com/send?phone=" & ph & "&text=" & UrlText(msg)
            Else
                url = "whatsapp://send?phone=" & ph & "&text=" & UrlText(msg)
            End If
            ThisWorkbook.FollowHyperlink url
            If cFile > 0 Then
                f = Trim(CStr(ws.Cells(r, cFile).Value))
                If Len(f) > 0 Then
                    If Len(Dir(f)) > 0 Then Shell "explorer.exe /select,""" & f & """", vbNormalFocus
                End If
            End If
            ws.Cells(r, cSt).Value = "Opened " & Format(Now, "dd-mmm hh:mm")
            n = n + 1
            Application.Wait Now + TimeSerial(0, 0, waitS)
        End If
    Next r
    LogLine "WhatsApp", "", n & " chats opened"
    MsgBox n & " WhatsApp chat(s) opened.", vbInformation
    Exit Sub
fail:
    ShowError "WhatsApp"
End Sub
`,
  },

  print: {
    name: "Bulk print & PDF", icon: "🖨️", desc: "Print a list of Excel files (a chosen sheet or the whole file) or any other files, or save each Excel file as a PDF with an automatic name — in one click.",
    sheets: [{ name: "Files", cols: [["File path", "path", 50], ["Sheet", "text", 16], ["Copies", "number", 9], ["Status", "text", 26]], rows: [["C:\\Reports\\Bihar_Oct.xlsx", "Summary", 1, ""], ["C:\\Reports\\UP_Oct.xlsx", "", 2, ""], ["C:\\Reports\\Scheme_Letter.pdf", "", 1, ""]], note: "Sheet empty = whole file. Non-Excel files (PDF, Word…) are printed by their own app." }],
    settings: [["Output folder", "", "Where PDFs are saved. Empty = this file's folder"], ["PDF name", "{value} {date}", "{value} = the file's name, {date} = today"]],
    macros: [["PrintFiles", "🖨️ Print all"], ["SaveFilesAsPDF", "📄 Save all as PDF"], ["ChooseOutputFolder", "📁 Choose output folder"]],
    code: `Option Explicit
Public Sub PrintFiles()
    Dim ws As Worksheet, r As Long, last As Long, cP As Long, cS As Long, cN As Long, cSt As Long, p As String, wb As Workbook, n As Long, nCopies As Long
    On Error GoTo fail
    Set ws = ThisWorkbook.Worksheets("Files")
    cP = NeedCol(ws, "File path"): cS = ColOf(ws, "Sheet"): cN = ColOf(ws, "Copies"): cSt = NeedCol(ws, "Status")
    last = LastRow(ws, cP)
    If MsgBox("Print " & (last - 1) & " file(s) on the default printer?", vbYesNo + vbQuestion) <> vbYes Then Exit Sub
    SpeedOn
    For r = 2 To last
        p = Trim(CStr(ws.Cells(r, cP).Value))
        nCopies = 1
        If cN > 0 Then nCopies = Val(ws.Cells(r, cN).Value)
        If nCopies < 1 Then nCopies = 1
        If Len(p) = 0 Then
        ElseIf Len(Dir(p)) = 0 Then
            ws.Cells(r, cSt).Value = "Not found"
        ElseIf LCase(p) Like "*.xls*" Or LCase(p) Like "*.csv" Then
            Application.StatusBar = "Printing " & p
            Set wb = Workbooks.Open(p, UpdateLinks:=0, ReadOnly:=True)
            If cS > 0 And Len(Trim(CStr(ws.Cells(r, cS).Value))) > 0 Then
                wb.Worksheets(Trim(CStr(ws.Cells(r, cS).Value))).PrintOut Copies:=nCopies
            Else
                wb.PrintOut Copies:=nCopies
            End If
            wb.Close SaveChanges:=False
            ws.Cells(r, cSt).Value = "Printed " & Format(Now, "dd-mmm hh:mm"): n = n + 1
        Else
            CreateObject("Shell.Application").ShellExecute p, "", "", "print", 0
            ws.Cells(r, cSt).Value = "Sent to printer " & Format(Now, "dd-mmm hh:mm"): n = n + 1
        End If
    Next r
    SpeedOff
    LogLine "Print", "", n & " printed"
    MsgBox n & " file(s) printed.", vbInformation
    Exit Sub
fail:
    ShowError "Print"
End Sub

Public Sub SaveFilesAsPDF()
    Dim ws As Worksheet, r As Long, last As Long, cP As Long, cS As Long, cSt As Long, p As String, wb As Workbook, outF As String, nm As String, n As Long
    On Error GoTo fail
    Set ws = ThisWorkbook.Worksheets("Files")
    cP = NeedCol(ws, "File path"): cS = ColOf(ws, "Sheet"): cSt = NeedCol(ws, "Status")
    outF = FolderPath(Setting("Output folder")): EnsureFolder outF
    last = LastRow(ws, cP)
    SpeedOn
    For r = 2 To last
        p = Trim(CStr(ws.Cells(r, cP).Value))
        If Len(p) = 0 Then
        ElseIf Len(Dir(p)) = 0 Then
            ws.Cells(r, cSt).Value = "Not found"
        ElseIf LCase(p) Like "*.xls*" Or LCase(p) Like "*.csv" Then
            Application.StatusBar = "Saving PDF of " & p
            Set wb = Workbooks.Open(p, UpdateLinks:=0, ReadOnly:=True)
            nm = Mid(p, InStrRev(p, Application.PathSeparator) + 1): nm = Left(nm, InStrRev(nm, ".") - 1)
            nm = outF & FillPattern(Setting("PDF name", "{value} {date}"), nm) & ".pdf"
            If cS > 0 And Len(Trim(CStr(ws.Cells(r, cS).Value))) > 0 Then
                wb.Worksheets(Trim(CStr(ws.Cells(r, cS).Value))).ExportAsFixedFormat Type:=xlTypePDF, Filename:=nm, OpenAfterPublish:=False
            Else
                wb.ExportAsFixedFormat Type:=xlTypePDF, Filename:=nm, OpenAfterPublish:=False
            End If
            wb.Close SaveChanges:=False
            ws.Cells(r, cSt).Value = "PDF: " & nm: n = n + 1
        Else
            ws.Cells(r, cSt).Value = "Not an Excel file"
        End If
    Next r
    SpeedOff
    LogLine "Save as PDF", outF, n & " PDFs"
    MsgBox n & " PDF(s) saved in:" & vbCrLf & outF, vbInformation
    Exit Sub
fail:
    ShowError "Save as PDF"
End Sub
`,
  },

  refresh: {
    name: "Open, refresh & close files", icon: "🔄", desc: "Opens each file in the list, refreshes all its data connections and pivots, recalculates, saves (optional) and closes it — or just opens / closes them all.",
    sheets: [{ name: "Files", cols: [["File path", "path", 54], ["Status", "text", 30]], rows: [["C:\\Reports\\Daily_Sellout.xlsx", ""], ["C:\\Reports\\Stock_Ageing.xlsx", ""], ["C:\\Reports\\Scheme_Tracker.xlsm", ""]], note: "Full path of each file." }],
    settings: [["Save after refresh", "Yes", "Yes / No"], ["Wait seconds", "5", "Extra wait for slow data connections"]],
    macros: [["RefreshFiles", "🔄 Refresh all files"], ["OpenAllFiles", "📂 Open all files"], ["CloseOtherFiles", "✖ Close other files"]],
    code: `Option Explicit
Public Sub RefreshFiles()
    Dim ws As Worksheet, r As Long, last As Long, cP As Long, cSt As Long, p As String, wb As Workbook, n As Long, t0 As Double
    On Error GoTo fail
    Set ws = ThisWorkbook.Worksheets("Files")
    cP = NeedCol(ws, "File path"): cSt = NeedCol(ws, "Status")
    last = LastRow(ws, cP)
    For r = 2 To last
        p = Trim(CStr(ws.Cells(r, cP).Value))
        If Len(p) > 0 Then
            If Len(Dir(p)) = 0 Then
                ws.Cells(r, cSt).Value = "Not found"
            Else
                t0 = Timer
                Application.StatusBar = "Refreshing " & p
                Set wb = Workbooks.Open(p, UpdateLinks:=3)
                wb.RefreshAll
                On Error Resume Next
                Application.CalculateUntilAsyncQueriesDone
                On Error GoTo fail
                Application.Wait Now + TimeSerial(0, 0, Val(Setting("Wait seconds", "5")))
                Application.CalculateFull
                wb.Close SaveChanges:=(LCase(Setting("Save after refresh", "Yes")) = "yes")
                ws.Cells(r, cSt).Value = "Refreshed " & Format(Now, "dd-mmm hh:mm") & " (" & Format(Timer - t0, "0") & " s)"
                n = n + 1
            End If
        End If
    Next r
    Application.StatusBar = False
    LogLine "Refresh files", "", n & " refreshed"
    MsgBox n & " file(s) refreshed.", vbInformation
    Exit Sub
fail:
    ShowError "Refresh files"
End Sub

Public Sub OpenAllFiles()
    Dim ws As Worksheet, r As Long, cP As Long, p As String, n As Long
    On Error GoTo fail
    Set ws = ThisWorkbook.Worksheets("Files")
    cP = NeedCol(ws, "File path")
    For r = 2 To LastRow(ws, cP)
        p = Trim(CStr(ws.Cells(r, cP).Value))
        If Len(p) > 0 Then
            If Len(Dir(p)) > 0 Then Workbooks.Open p, UpdateLinks:=0: n = n + 1
        End If
    Next r
    MsgBox n & " file(s) opened.", vbInformation
    Exit Sub
fail:
    ShowError "Open files"
End Sub

Public Sub CloseOtherFiles()
    Dim wb As Workbook, n As Long, ans As VbMsgBoxResult
    ans = MsgBox("Close every other open Excel file?" & vbCrLf & "Yes = save changes · No = close without saving", vbYesNoCancel + vbQuestion)
    If ans = vbCancel Then Exit Sub
    For Each wb In Application.Workbooks
        If Not wb Is ThisWorkbook Then
            wb.Close SaveChanges:=(ans = vbYes)
            n = n + 1
        End If
    Next wb
    MsgBox n & " file(s) closed.", vbInformation
End Sub
`,
  },

  split: {
    name: "Split data into files", icon: "✂️", desc: "Splits the Data sheet into one Excel (or PDF) file per value of a column — e.g. one file per state or dealer — named automatically, and lists them; can then e-mail each file to its contact.",
    sheets: [{ name: "Data", cols: SALES_COLS, rows: salesRows(60), note: "Paste your raw data here (row 1 = headers)." },
      { name: "Contacts", cols: [["Value", "text", 20], ["Email", "email", 30], ["CC", "email", 26]], rows: [["Bihar", "bihar.bi@example.com", ""], ["Uttar Pradesh", "up.bi@example.com", ""], ["Maharashtra", "mh.bi@example.com", ""]], note: "Optional: who gets which file when you click “E-mail the files”." },
      { name: "Output", cols: [["Value", "text", 20], ["Rows", "number", 8], ["File", "path", 60], ["Mailed", "text", 18]], rows: [], note: "Filled by the macro." }],
    settings: [["Split by", "State", "Column header to split on"], ["Output folder", "", "Empty = a “Split files” folder next to this file"], ["File name", "{value} sales {month}", "{value} = the column value, {date}, {month}, {time}"], ["Save as", "xlsx", "xlsx or pdf"], ["Mail subject", "{value} – sales file {month}", ""], ["Mail message", "Hello,\nPlease find the {value} file attached.\nRegards", ""], ["Send mode", "Display", "Display / Send"]],
    macros: [["SplitToFiles", "✂️ Split into files"], ["MailSplitFiles", "📧 E-mail the files"], ["ChooseOutputFolder", "📁 Choose output folder"]],
    code: `Option Explicit
Public Sub SplitToFiles()
    Dim ws As Worksheet, wo As Worksheet, col As Long, last As Long, lc As Long, r As Long, v As Variant, keys As New Collection
    Dim outF As String, nm As String, wb As Workbook, n As Long, k As Variant, rng As Range, cnt As Long
    On Error GoTo fail
    Set ws = ThisWorkbook.Worksheets("Data"): Set wo = ThisWorkbook.Worksheets("Output")
    col = NeedCol(ws, Setting("Split by", "State"))
    last = LastDataRow(ws): lc = LastCol(ws)
    If last < 2 Then MsgBox "The Data sheet is empty.", vbInformation: Exit Sub
    outF = Setting("Output folder"): If Len(outF) = 0 Then outF = FolderPath("") & "Split files"
    outF = FolderPath(outF): EnsureFolder outF
    On Error Resume Next
    For r = 2 To last
        v = Trim(CStr(ws.Cells(r, col).Value))
        If Len(v) > 0 Then keys.Add v, CStr(v)
    Next r
    On Error GoTo fail
    If wo.AutoFilterMode Then wo.AutoFilterMode = False
    If LastDataRow(wo) > 1 Then wo.Range(wo.Cells(2, 1), wo.Cells(LastDataRow(wo), 4)).ClearContents
    SpeedOn
    If ws.AutoFilterMode Then ws.AutoFilterMode = False
    For Each k In keys
        Application.StatusBar = "Creating file for " & k
        ws.Range(ws.Cells(1, 1), ws.Cells(last, lc)).AutoFilter Field:=col, Criteria1:=CStr(k)
        Set rng = ws.Range(ws.Cells(1, 1), ws.Cells(last, lc)).SpecialCells(xlCellTypeVisible)
        cnt = Application.WorksheetFunction.Subtotal(103, ws.Range(ws.Cells(2, col), ws.Cells(last, col)))
        Set wb = Workbooks.Add(xlWBATWorksheet)
        rng.Copy
        wb.Worksheets(1).Range("A1").PasteSpecial xlPasteValuesAndNumberFormats
        wb.Worksheets(1).Range("A1").PasteSpecial xlPasteColumnWidths
        Application.CutCopyMode = False
        wb.Worksheets(1).Name = Left(SafeName(CStr(k)), 31)
        wb.Worksheets(1).Rows(1).Font.Bold = True
        nm = outF & FillPattern(Setting("File name", "{value} {date}"), CStr(k))
        If LCase(Setting("Save as", "xlsx")) = "pdf" Then
            nm = nm & ".pdf"
            wb.Worksheets(1).ExportAsFixedFormat Type:=xlTypePDF, Filename:=nm, OpenAfterPublish:=False
            wb.Close SaveChanges:=False
        Else
            nm = nm & ".xlsx"
            wb.SaveAs Filename:=nm, FileFormat:=xlOpenXMLWorkbook
            wb.Close SaveChanges:=False
        End If
        n = n + 1
        wo.Cells(n + 1, 1).Value = k: wo.Cells(n + 1, 2).Value = cnt: wo.Cells(n + 1, 3).Value = nm
    Next k
    ws.AutoFilterMode = False
    SpeedOff
    LogLine "Split into files", outF, n & " files"
    MsgBox n & " file(s) created in:" & vbCrLf & outF & vbCrLf & vbCrLf & "They are listed on the Output sheet.", vbInformation
    Exit Sub
fail:
    On Error Resume Next
    Application.CutCopyMode = False
    ws.AutoFilterMode = False
    ShowError "Split into files"
End Sub

Public Sub MailSplitFiles()
    Dim wo As Worksheet, wc As Worksheet, ol As Object, m As Object, r As Long, cr As Long, v As String, em As String, cc As String, n As Long
    On Error GoTo fail
    Set wo = ThisWorkbook.Worksheets("Output"): Set wc = ThisWorkbook.Worksheets("Contacts")
    On Error Resume Next
    Set ol = GetObject(, "Outlook.Application")
    If ol Is Nothing Then Set ol = CreateObject("Outlook.Application")
    On Error GoTo fail
    If ol Is Nothing Then MsgBox "Outlook is not available on this computer.", vbExclamation: Exit Sub
    For r = 2 To LastRow(wo, 1)
        v = CStr(wo.Cells(r, 1).Value): em = "": cc = ""
        For cr = 2 To LastRow(wc, 1)
            If LCase(Trim(CStr(wc.Cells(cr, 1).Value))) = LCase(v) Then em = CStr(wc.Cells(cr, 2).Value): cc = CStr(wc.Cells(cr, 3).Value): Exit For
        Next cr
        If Len(em) = 0 Then
            wo.Cells(r, 4).Value = "No contact"
        ElseIf Len(Dir(CStr(wo.Cells(r, 3).Value))) = 0 Then
            wo.Cells(r, 4).Value = "File missing"
        Else
            Set m = ol.CreateItem(0)
            m.To = em: m.CC = cc
            m.Subject = FillPattern(Setting("Mail subject", "{value} file"), v)
            m.Body = Replace(Replace(Setting("Mail message", "Please find the file attached."), "{value}", v), "\\n", vbCrLf)
            m.Attachments.Add CStr(wo.Cells(r, 3).Value)
            If LCase(Setting("Send mode", "Display")) = "send" Then
                m.Send
            Else
                m.Display
            End If
            wo.Cells(r, 4).Value = "Mailed " & Format(Now, "dd-mmm hh:mm"): n = n + 1
        End If
    Next r
    LogLine "Mail split files", "", n & " mails"
    MsgBox n & " e-mail(s) done.", vbInformation
    Exit Sub
fail:
    ShowError "E-mail the files"
End Sub
`,
  },

  merge: {
    name: "Merge files from a folder", icon: "🧩", desc: "Combines every Excel / CSV file in a folder into one sheet (headers once), adds the source file name to each row — ready for pivots or the dashboard.",
    sheets: [{ name: "Merged", cols: [["Source file", "text", 26], ["Date", "date", 12], ["State", "text", 16], ["Dealer code", "text", 13], ["Model", "text", 15], ["Qty", "number", 8]], rows: [["Bihar_Oct.xlsx", day(2), "Bihar", "DLR10101", "vivo V60", 4], ["UP_Oct.xlsx", day(3), "Uttar Pradesh", "DLR10122", "vivo Y300", 7]], note: "Filled by the macro — all rows from all files." }],
    settings: [["Folder", "", "Folder with the files to merge. Empty = this file's folder"], ["File type", "*.xls*", "e.g. *.xlsx or *.csv"], ["Sheet name", "", "Sheet to take from each file. Empty = the first sheet"], ["Header rows", "1", "Rows of headers at the top of each file"]],
    macros: [["ChooseFolder", "📁 Choose folder"], ["MergeFolder", "🧩 Merge all files"]],
    code: `Option Explicit
Public Sub MergeFolder()
    Dim ws As Worksheet, folder As String, f As String, wb As Workbook, src As Worksheet, hdr As Long, first As Boolean
    Dim lr As Long, lc As Long, outR As Long, n As Long, rows As Long, shName As String
    On Error GoTo fail
    Set ws = ThisWorkbook.Worksheets("Merged")
    folder = FolderPath(Setting("Folder")): hdr = Val(Setting("Header rows", "1")): shName = Setting("Sheet name")
    If MsgBox("Merge every " & Setting("File type", "*.xls*") & " file in:" & vbCrLf & folder & vbCrLf & "into the Merged sheet? (It is cleared first.)", vbYesNo + vbQuestion) <> vbYes Then Exit Sub
    ws.Cells.Clear
    first = True: outR = 1
    SpeedOn
    f = Dir(folder & Setting("File type", "*.xls*"))
    Do While Len(f) > 0
        If f <> ThisWorkbook.Name And Left(f, 2) <> "~$" Then
            Application.StatusBar = "Merging " & f
            Set wb = Workbooks.Open(folder & f, UpdateLinks:=0, ReadOnly:=True)
            If Len(shName) > 0 Then Set src = wb.Worksheets(shName) Else Set src = wb.Worksheets(1)
            lr = LastDataRow(src): lc = src.Cells(1, src.Columns.Count).End(xlToLeft).Column
            If first And hdr > 0 Then
                ws.Cells(1, 1).Value = "Source file"
                src.Range(src.Cells(hdr, 1), src.Cells(hdr, lc)).Copy
                ws.Cells(1, 2).PasteSpecial xlPasteValues
                outR = 2: first = False
            End If
            If lr > hdr Then
                src.Range(src.Cells(hdr + 1, 1), src.Cells(lr, lc)).Copy
                ws.Cells(outR, 2).PasteSpecial xlPasteValuesAndNumberFormats
                ws.Range(ws.Cells(outR, 1), ws.Cells(outR + lr - hdr - 1, 1)).Value = f
                outR = outR + lr - hdr: rows = rows + lr - hdr
            End If
            Application.CutCopyMode = False
            wb.Close SaveChanges:=False
            n = n + 1
        End If
        f = Dir()
    Loop
    ws.Rows(1).Font.Bold = True
    ws.Cells.EntireColumn.AutoFit
    SpeedOff
    LogLine "Merge folder", folder, n & " files, " & rows & " rows"
    MsgBox n & " file(s) merged, " & rows & " row(s).", vbInformation
    Exit Sub
fail:
    ShowError "Merge files"
End Sub
`,
  },

  dashboard: {
    name: "Auto dashboard & insights", icon: "📊", desc: "Turns the raw Data sheet into a Dashboard sheet in one click: KPI tiles, totals by state / model / month with charts, top & bottom performers and written insights. Re-run after pasting new data.",
    sheets: [{ name: "Data", cols: SALES_COLS, rows: salesRows(120), note: "Paste your raw data here (row 1 = headers). Column names are set in Settings." }, { name: "Dashboard", cols: [], rows: [], note: "" }],
    settings: [["Date column", "Date", "Header of the date column"], ["Group 1", "State", "First breakdown (bar chart)"], ["Group 2", "Model", "Second breakdown (pie chart, top 6)"], ["Count column", "Dealer code", "Unique count shown as a KPI, e.g. dealers"], ["Value column", "Value", "Main number (sum)"], ["Qty column", "Qty", "Second number (sum); empty = none"], ["Title", "Sell-out dashboard", "Title on the dashboard"]],
    macros: [["BuildDashboard", "📊 Build / refresh dashboard"]],
    code: `Option Explicit
Private Sub SortDesc(names() As String, vals() As Double, ByVal n As Long)
    Dim i As Long, j As Long, tn As String, tv As Double
    For i = 1 To n - 1
        For j = i + 1 To n
            If vals(j) > vals(i) Then
                tv = vals(i): vals(i) = vals(j): vals(j) = tv
                tn = names(i): names(i) = names(j): names(j) = tn
            End If
        Next j
    Next i
End Sub

Private Function Grouped(ws As Worksheet, ByVal gCol As Long, ByVal vCol As Long, ByVal last As Long, names() As String, vals() As Double, ByVal asMonth As Boolean) As Long
    Dim d As Object, r As Long, k As String, i As Long, kk As Variant
    Set d = CreateObject("Scripting.Dictionary")
    For r = 2 To last
        If asMonth Then
            If IsDate(ws.Cells(r, gCol).Value) Then k = Format(CDate(ws.Cells(r, gCol).Value), "yyyy-mm") Else k = ""
        Else
            k = Trim(CStr(ws.Cells(r, gCol).Value))
        End If
        If Len(k) > 0 Then d(k) = d(k) + Val(ws.Cells(r, vCol).Value)
    Next r
    ReDim names(1 To IIf(d.Count = 0, 1, d.Count)): ReDim vals(1 To IIf(d.Count = 0, 1, d.Count))
    i = 0
    For Each kk In d.Keys
        i = i + 1: names(i) = CStr(kk): vals(i) = d(kk)
    Next kk
    Grouped = d.Count
End Function

Private Sub Tile(db As Worksheet, ByVal col As Long, ByVal label As String, ByVal v As Variant, ByVal fmt As String)
    With db.Range(db.Cells(4, col), db.Cells(4, col + 1))
        .Merge: .Value = label: .Font.Size = 9: .Font.Color = RGB(91, 96, 128): .HorizontalAlignment = xlCenter
        .Interior.Color = RGB(238, 240, 255)
    End With
    With db.Range(db.Cells(5, col), db.Cells(5, col + 1))
        .Merge: .Value = v: .NumberFormat = fmt: .Font.Size = 16: .Font.Bold = True: .Font.Color = RGB(43, 51, 166): .HorizontalAlignment = xlCenter
        .Interior.Color = RGB(238, 240, 255)
    End With
End Sub

Private Function AddChart(db As Worksheet, ByVal kind As Long, src As Range, ByVal title As String, ByVal l As Double, ByVal t As Double) As ChartObject
    Dim co As ChartObject
    Set co = db.ChartObjects.Add(l, t, 380, 220)
    co.Chart.ChartType = kind
    co.Chart.SetSourceData Source:=src
    co.Chart.HasTitle = True: co.Chart.ChartTitle.Text = title
    co.Chart.HasLegend = (kind = xlPie Or kind = xlDoughnut)
    Set AddChart = co
End Function

Public Sub BuildDashboard()
    Dim ws As Worksheet, db As Worksheet, last As Long, cD As Long, cG1 As Long, cG2 As Long, cC As Long, cV As Long, cQ As Long
    Dim n1() As String, v1() As Double, k1 As Long, n2() As String, v2() As Double, k2 As Long, n3() As String, v3() As Double, k3 As Long
    Dim totV As Double, totQ As Double, uniq As Object, r As Long, i As Long, row0 As Long, ins As String, co As ChartObject, j As Long
    On Error GoTo fail
    Set ws = ThisWorkbook.Worksheets("Data"): Set db = ThisWorkbook.Worksheets("Dashboard")
    last = LastDataRow(ws)
    If last < 2 Then MsgBox "The Data sheet is empty.", vbInformation: Exit Sub
    cD = ColOf(ws, Setting("Date column", "Date")): cG1 = NeedCol(ws, Setting("Group 1", "State")): cG2 = ColOf(ws, Setting("Group 2", "Model"))
    cC = ColOf(ws, Setting("Count column", "Dealer code")): cV = NeedCol(ws, Setting("Value column", "Value")): cQ = ColOf(ws, Setting("Qty column", "Qty"))
    SpeedOn
    For Each co In db.ChartObjects: co.Delete: Next co
    db.Cells.Clear
    ActiveWindow.DisplayGridlines = True
    Set uniq = CreateObject("Scripting.Dictionary")
    For r = 2 To last
        totV = totV + Val(ws.Cells(r, cV).Value)
        If cQ > 0 Then totQ = totQ + Val(ws.Cells(r, cQ).Value)
        If cC > 0 Then uniq(CStr(ws.Cells(r, cC).Value)) = 1
    Next r
    db.Range("A1").Value = Setting("Title", "Dashboard"): db.Range("A1").Font.Size = 18: db.Range("A1").Font.Bold = True: db.Range("A1").Font.Color = RGB(43, 51, 166)
    db.Range("A2").Value = "Built " & Format(Now, "dd-mmm-yyyy hh:mm") & " from " & (last - 1) & " rows of the Data sheet": db.Range("A2").Font.Color = RGB(91, 96, 128)
    Tile db, 1, "Total " & ws.Cells(1, cV).Value, totV, "#,##0"
    If cQ > 0 Then Tile db, 3, "Total " & ws.Cells(1, cQ).Value, totQ, "#,##0"
    If cC > 0 Then Tile db, 5, ws.Cells(1, cC).Value & " (unique)", uniq.Count, "#,##0"
    If cQ > 0 And totQ > 0 Then Tile db, 7, "Average per unit", totV / totQ, "#,##0"
    ' --- group 1
    k1 = Grouped(ws, cG1, cV, last, n1, v1, False): SortDesc n1, v1, k1
    row0 = 8
    db.Cells(row0, 1).Value = ws.Cells(1, cG1).Value: db.Cells(row0, 2).Value = ws.Cells(1, cV).Value: db.Cells(row0, 3).Value = "Share"
    For i = 1 To k1
        db.Cells(row0 + i, 1).Value = n1(i): db.Cells(row0 + i, 2).Value = v1(i): db.Cells(row0 + i, 3).Value = IIf(totV = 0, 0, v1(i) / totV)
    Next i
    db.Range(db.Cells(row0 + 1, 2), db.Cells(row0 + k1, 2)).NumberFormat = "#,##0": db.Range(db.Cells(row0 + 1, 3), db.Cells(row0 + k1, 3)).NumberFormat = "0.0%"
    AddChart db, xlBarClustered, db.Range(db.Cells(row0, 1), db.Cells(row0 + k1, 2)), ws.Cells(1, cV).Value & " by " & ws.Cells(1, cG1).Value, db.Cells(row0, 5).Left, db.Cells(row0, 5).Top
    ' --- month trend
    If cD > 0 Then
        k3 = Grouped(ws, cD, cV, last, n3, v3, True)
        For i = 1 To k3 - 1
            For j = i + 1 To k3
                If n3(j) < n3(i) Then ins = n3(i): n3(i) = n3(j): n3(j) = ins: totQ = v3(i): v3(i) = v3(j): v3(j) = totQ
            Next j
        Next i
        db.Cells(row0, 12).Value = "Month": db.Cells(row0, 13).Value = ws.Cells(1, cV).Value
        For i = 1 To k3
            db.Cells(row0 + i, 12).NumberFormat = "@": db.Cells(row0 + i, 12).Value = n3(i): db.Cells(row0 + i, 13).Value = v3(i)
        Next i
        db.Range(db.Cells(row0 + 1, 13), db.Cells(row0 + k3, 13)).NumberFormat = "#,##0"
        If k3 > 0 Then AddChart db, xlColumnClustered, db.Range(db.Cells(row0, 12), db.Cells(row0 + k3, 13)), ws.Cells(1, cV).Value & " by month", db.Cells(row0 + 17, 5).Left, db.Cells(row0 + 17, 5).Top
    End If
    ' --- group 2 (top 6 + others)
    If cG2 > 0 Then
        k2 = Grouped(ws, cG2, cV, last, n2, v2, False): SortDesc n2, v2, k2
        db.Cells(row0, 15).Value = ws.Cells(1, cG2).Value: db.Cells(row0, 16).Value = ws.Cells(1, cV).Value
        For i = 1 To Application.Min(k2, 6)
            db.Cells(row0 + i, 15).Value = n2(i): db.Cells(row0 + i, 16).Value = v2(i)
        Next i
        If k2 > 6 Then
            totQ = 0: For i = 7 To k2: totQ = totQ + v2(i): Next i
            db.Cells(row0 + 7, 15).Value = "Others": db.Cells(row0 + 7, 16).Value = totQ
        End If
        db.Range(db.Cells(row0 + 1, 16), db.Cells(row0 + 7, 16)).NumberFormat = "#,##0"
        AddChart db, xlPie, db.Range(db.Cells(row0, 15), db.Cells(row0 + Application.Min(k2, 6) - (k2 > 6), 16)), "Share by " & ws.Cells(1, cG2).Value, db.Cells(row0 + 34, 5).Left, db.Cells(row0 + 34, 5).Top
    End If
    ' --- insights
    i = row0 + k1 + 3
    db.Cells(i, 1).Value = "Insights": db.Cells(i, 1).Font.Bold = True: db.Cells(i, 1).Font.Size = 13
    ins = "• " & n1(1) & " is the top " & LCase(ws.Cells(1, cG1).Value) & " with " & Format(v1(1), "#,##0") & " (" & Format(IIf(totV = 0, 0, v1(1) / totV), "0%") & " of the total)."
    db.Cells(i + 1, 1).Value = ins
    If k1 > 1 Then db.Cells(i + 2, 1).Value = "• " & n1(k1) & " is the lowest with " & Format(v1(k1), "#,##0") & " — " & Format(IIf(v1(1) = 0, 0, v1(k1) / v1(1)), "0%") & " of the top."
    If k1 >= 3 Then db.Cells(i + 3, 1).Value = "• The top 3 together make " & Format(IIf(totV = 0, 0, (v1(1) + v1(2) + v1(3)) / totV), "0%") & " of the total."
    If cG2 > 0 And k2 > 0 Then db.Cells(i + 4, 1).Value = "• Best " & LCase(ws.Cells(1, cG2).Value) & ": " & n2(1) & " (" & Format(IIf(totV = 0, 0, v2(1) / totV), "0%") & ")."
    If cD > 0 And k3 >= 2 Then
        If v3(k3 - 1) <> 0 Then db.Cells(i + 5, 1).Value = "• " & n3(k3) & " vs " & n3(k3 - 1) & ": " & Format((v3(k3) - v3(k3 - 1)) / v3(k3 - 1), "+0%;-0%") & " (latest month may be partial)."
    End If
    db.Range(db.Cells(row0, 1), db.Cells(row0, 3)).Font.Bold = True: db.Range(db.Cells(row0, 12), db.Cells(row0, 16)).Font.Bold = True
    db.Columns("A").ColumnWidth = 22: db.Columns("B:C").ColumnWidth = 13: db.Columns("L:P").ColumnWidth = 13
    SpeedOff
    db.Activate: db.Range("A1").Select
    LogLine "Dashboard", "", (last - 1) & " rows"
    Exit Sub
fail:
    ShowError "Build dashboard"
End Sub
`,
  },

  clean: {
    name: "Clean raw data", icon: "🧹", desc: "Cleans the Data sheet in one click: trims extra spaces, turns numbers stored as text into numbers, removes empty rows and exact duplicate rows — and reports what changed.",
    sheets: [{ name: "Data", cols: SALES_COLS, rows: salesRows(30).concat([[day(5), "  Bihar ", "DLR10111", "Bihar Mobiles 2", "vivo T4", "3", "74997"], ["", "", "", "", "", "", ""], [day(5), "  Bihar ", "DLR10111", "Bihar Mobiles 2", "vivo T4", "3", "74997"]]), note: "Paste your raw data here (row 1 = headers)." }],
    settings: [["Duplicate key columns", "", "Headers that define a duplicate, separated by commas. Empty = the whole row"]],
    macros: [["CleanData", "🧹 Clean the data"]],
    code: `Option Explicit
Public Sub CleanData()
    Dim ws As Worksheet, last As Long, lc As Long, r As Long, c As Long, v As Variant, trimmed As Long, nums As Long, blanks As Long, before As Long
    Dim keys() As Variant, parts As Variant, i As Long, cl As Long
    On Error GoTo fail
    Set ws = ThisWorkbook.Worksheets("Data")
    last = LastDataRow(ws): lc = LastCol(ws)
    If last < 2 Then MsgBox "The Data sheet is empty.", vbInformation: Exit Sub
    SpeedOn
    For r = 2 To last
        For c = 1 To lc
            v = ws.Cells(r, c).Value
            If VarType(v) = vbString Then
                If Application.WorksheetFunction.Trim(v) <> v Then ws.Cells(r, c).Value = Application.WorksheetFunction.Trim(v): trimmed = trimmed + 1: v = ws.Cells(r, c).Value
                If Len(v) > 0 And IsNumeric(v) And Left(v, 1) <> "0" Then ws.Cells(r, c).Value = CDbl(v): nums = nums + 1
            End If
        Next c
    Next r
    For r = last To 2 Step -1
        If Application.WorksheetFunction.CountA(ws.Range(ws.Cells(r, 1), ws.Cells(r, lc))) = 0 Then ws.Rows(r).Delete: blanks = blanks + 1
    Next r
    last = LastDataRow(ws): before = last
    If Len(Setting("Duplicate key columns")) > 0 Then
        parts = Split(Setting("Duplicate key columns"), ",")
        ReDim keys(0 To UBound(parts))
        For i = 0 To UBound(parts): keys(i) = NeedCol(ws, Trim(parts(i))): Next i
    Else
        ReDim keys(0 To lc - 1)
        For i = 0 To lc - 1: keys(i) = i + 1: Next i
    End If
    ws.Range(ws.Cells(1, 1), ws.Cells(last, lc)).RemoveDuplicates Columns:=(keys), Header:=xlYes
    last = LastDataRow(ws)
    SpeedOff
    LogLine "Clean data", "", trimmed & " trimmed, " & nums & " numbers fixed, " & blanks & " empty rows, " & (before - last) & " duplicates"
    MsgBox "Done:" & vbCrLf & trimmed & " cell(s) trimmed" & vbCrLf & nums & " number(s) stored as text fixed" & vbCrLf & blanks & " empty row(s) removed" & vbCrLf & (before - last) & " duplicate row(s) removed", vbInformation
    Exit Sub
fail:
    ShowError "Clean data"
End Sub
`,
  },

  backup: {
    name: "Auto-named copies & backups", icon: "💾", desc: "Saves a dated copy of this workbook (or of every file in a list) with an automatic name — e.g. “Sellout 2026-11-15 0930.xlsx” — into a backup folder.",
    sheets: [{ name: "Files", cols: [["File path", "path", 54], ["Status", "text", 40]], rows: [["C:\\Reports\\Daily_Sellout.xlsx", ""], ["C:\\Reports\\Stock.xlsx", ""]], note: "Files to copy with “Back up listed files”." }],
    settings: [["Output folder", "", "Backup folder. Empty = a “Backup” folder next to this file"], ["Copy name", "{value} {date} {time}", "{value} = the file name"]],
    macros: [["SaveDatedCopy", "💾 Save a dated copy of this file"], ["BackupListedFiles", "🗂️ Back up listed files"], ["ChooseOutputFolder", "📁 Choose backup folder"]],
    code: `Option Explicit
Private Function BackupFolder() As String
    Dim p As String
    p = Setting("Output folder"): If Len(p) = 0 Then p = FolderPath("") & "Backup"
    p = FolderPath(p): EnsureFolder p
    BackupFolder = p
End Function

Public Sub SaveDatedCopy()
    Dim nm As String, ext As String, target As String
    On Error GoTo fail
    nm = ThisWorkbook.Name: ext = Mid(nm, InStrRev(nm, ".")): nm = Left(nm, InStrRev(nm, ".") - 1)
    target = BackupFolder() & FillPattern(Setting("Copy name", "{value} {date} {time}"), nm) & ext
    ThisWorkbook.SaveCopyAs target
    LogLine "Dated copy", target
    MsgBox "Copy saved:" & vbCrLf & target, vbInformation
    Exit Sub
fail:
    ShowError "Save a dated copy"
End Sub

Public Sub BackupListedFiles()
    Dim ws As Worksheet, r As Long, cP As Long, cSt As Long, p As String, nm As String, ext As String, target As String, n As Long
    On Error GoTo fail
    Set ws = ThisWorkbook.Worksheets("Files")
    cP = NeedCol(ws, "File path"): cSt = NeedCol(ws, "Status")
    For r = 2 To LastRow(ws, cP)
        p = Trim(CStr(ws.Cells(r, cP).Value))
        If Len(p) > 0 Then
            If Len(Dir(p)) = 0 Then
                ws.Cells(r, cSt).Value = "Not found"
            Else
                nm = Mid(p, InStrRev(p, Application.PathSeparator) + 1)
                ext = "": If InStrRev(nm, ".") > 0 Then ext = Mid(nm, InStrRev(nm, ".")): nm = Left(nm, InStrRev(nm, ".") - 1)
                target = BackupFolder() & FillPattern(Setting("Copy name", "{value} {date} {time}"), nm) & ext
                FileCopy p, target
                ws.Cells(r, cSt).Value = "Copied to " & target: n = n + 1
            End If
        End If
    Next r
    LogLine "Backup files", "", n & " copied"
    MsgBox n & " file(s) copied.", vbInformation
    Exit Sub
fail:
    ShowError "Back up files"
End Sub
`,
  },
};
export const BLOCK_IDS = Object.keys(BLOCKS);
