#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <oaidl.h>
#include <oleauto.h>

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cwchar>
#include <cwctype>
#include <new>
#include <string>

namespace {

constexpr wchar_t kWindowClass[] = L"WpsHsmNativeComDialogProbeV1";
constexpr int kEditId = 1001;
constexpr DISPID kDispGetBridgeVersion = 101;
constexpr DISPID kDispGetProcessId = 102;
constexpr DISPID kDispGetProcessName = 103;
constexpr DISPID kDispShowInputDialog = 104;
constexpr DISPID kDispGetLastResult = 105;
constexpr DISPID kDispGetLastResultLength = 106;
constexpr DISPID kDispClearResult = 107;
constexpr DISPID kDispGetLastError = 108;

const CLSID kProbeClassId = {
    0x76F85F17, 0x71B3, 0x40E2, {0xA4, 0xCD, 0x50, 0xB7, 0x69, 0xFA, 0x37, 0xA7}};
const IID kIdtExtensibility2Id = {
    0xB65AD801, 0xABAF, 0x11D0, {0xBB, 0x8B, 0x00, 0xA0, 0xC9, 0x0F, 0x27, 0x44}};
const IID kNativeDialogAutomationId = {
    0x7B4641C6, 0x2E3B, 0x4FBF, {0x96, 0x11, 0x52, 0x57, 0x7C, 0xDD, 0xD0, 0xCA}};

enum ExtConnectMode : LONG {
    ExtAfterStartup = 0,
    ExtStartup = 1,
    ExtExternal = 2,
    ExtCommandLine = 3
};

enum ExtDisconnectMode : LONG {
    ExtHostShutdown = 0,
    ExtUserClosed = 1
};

struct IDTExtensibility2 : public IDispatch {
    virtual HRESULT STDMETHODCALLTYPE OnConnection(
        IDispatch* application,
        ExtConnectMode connect_mode,
        IDispatch* add_in_instance,
        SAFEARRAY** custom) = 0;
    virtual HRESULT STDMETHODCALLTYPE OnDisconnection(
        ExtDisconnectMode remove_mode,
        SAFEARRAY** custom) = 0;
    virtual HRESULT STDMETHODCALLTYPE OnAddInsUpdate(SAFEARRAY** custom) = 0;
    virtual HRESULT STDMETHODCALLTYPE OnStartupComplete(SAFEARRAY** custom) = 0;
    virtual HRESULT STDMETHODCALLTYPE OnBeginShutdown(SAFEARRAY** custom) = 0;
};

HINSTANCE g_module = nullptr;
LONG g_object_count = 0;
LONG g_server_locks = 0;

bool ReadSmallAsciiFile(const std::wstring& path, std::string* content) {
    if (content == nullptr) {
        return false;
    }
    content->clear();
    HANDLE file = CreateFileW(
        path.c_str(), GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        return false;
    }
    LARGE_INTEGER size{};
    const bool valid_size = GetFileSizeEx(file, &size) != FALSE &&
        size.QuadPart > 0 && size.QuadPart <= 8192;
    if (!valid_size) {
        CloseHandle(file);
        return false;
    }
    content->resize(static_cast<std::size_t>(size.QuadPart));
    DWORD read = 0;
    const BOOL read_ok = ReadFile(
        file, &(*content)[0], static_cast<DWORD>(content->size()), &read, nullptr);
    CloseHandle(file);
    if (read_ok == FALSE || read != content->size()) {
        content->clear();
        return false;
    }
    return true;
}

std::string ReadAsciiField(const std::string& content, const std::string& key) {
    const std::string prefix = key + "=";
    std::size_t start = 0;
    while (start < content.size()) {
        std::size_t end = content.find('\n', start);
        if (end == std::string::npos) {
            end = content.size();
        }
        std::size_t length = end - start;
        if (length > 0 && content[start + length - 1] == '\r') {
            --length;
        }
        if (length >= prefix.size() && content.compare(start, prefix.size(), prefix) == 0) {
            return content.substr(start + prefix.size(), length - prefix.size());
        }
        start = end + 1;
    }
    return std::string();
}

bool IsSafeToken(const std::string& value) {
    if (value.empty() || value.size() > 96) {
        return false;
    }
    for (const unsigned char character : value) {
        const bool valid = (character >= 'a' && character <= 'z') ||
            (character >= 'A' && character <= 'Z') ||
            (character >= '0' && character <= '9') ||
            character == '-' || character == '_';
        if (!valid) {
            return false;
        }
    }
    return true;
}

std::wstring AppDataDirectory() {
    const DWORD required = GetEnvironmentVariableW(L"APPDATA", nullptr, 0);
    if (required <= 1) {
        return std::wstring();
    }
    std::wstring value(static_cast<std::size_t>(required), L'\0');
    const DWORD written = GetEnvironmentVariableW(L"APPDATA", &value[0], required);
    if (written == 0 || written >= required) {
        return std::wstring();
    }
    value.resize(written);
    return value;
}

std::wstring ChannelFilePath(const std::wstring& process_name, bool response) {
    std::wstring root = AppDataDirectory();
    if (root.empty()) {
        return std::wstring();
    }
    root += L"\\WpsHighSchoolMath\\native-capability-probe\\";
    root += response ? L"response-" : L"command-";
    root += process_name;
    root += L".txt";
    return root;
}

std::string WideToUtf8(const std::wstring& value) {
    if (value.empty()) {
        return std::string();
    }
    const int required = WideCharToMultiByte(
        CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
        nullptr, 0, nullptr, nullptr);
    if (required <= 0) {
        return std::string();
    }
    std::string result(static_cast<std::size_t>(required), '\0');
    const int written = WideCharToMultiByte(
        CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
        &result[0], required, nullptr, nullptr);
    if (written != required) {
        return std::string();
    }
    return result;
}

std::wstring CurrentProcessName() {
    wchar_t path[MAX_PATH]{};
    const DWORD length = GetModuleFileNameW(nullptr, path, MAX_PATH);
    std::wstring name(path, length);
    const std::size_t slash = name.find_last_of(L"\\/");
    if (slash != std::wstring::npos) name.erase(0, slash + 1);
    for (wchar_t& character : name) character = static_cast<wchar_t>(towlower(character));
    return name;
}

void AppendComLoadTrace(const char* event_name) {
    if (event_name == nullptr || *event_name == '\0') {
        return;
    }
    std::wstring trace_path = AppDataDirectory();
    if (trace_path.empty()) {
        return;
    }
    trace_path += L"\\WpsHighSchoolMath\\native-capability-probe\\com-load-trace.txt";
    HANDLE file = CreateFileW(
        trace_path.c_str(), FILE_APPEND_DATA,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        return;
    }
    const std::string line =
        "pid=" + std::to_string(GetCurrentProcessId()) +
        " process=" + WideToUtf8(CurrentProcessName()) +
        " event=" + event_name + "\r\n";
    DWORD written = 0;
    WriteFile(file, line.data(), static_cast<DWORD>(line.size()), &written, nullptr);
    CloseHandle(file);
}

std::string SingleLineUtf8(const std::wstring& value) {
    std::string result = WideToUtf8(value);
    for (char& character : result) {
        if (character == '\r' || character == '\n') {
            character = ' ';
        }
    }
    return result;
}

bool WriteAtomicAsciiFile(const std::wstring& path, const std::string& content) {
    if (path.empty() || content.size() > 8192) {
        return false;
    }
    const std::wstring temporary = path + L".tmp-" + std::to_wstring(GetCurrentProcessId());
    HANDLE file = CreateFileW(
        temporary.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS,
        FILE_ATTRIBUTE_TEMPORARY, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        return false;
    }
    DWORD written = 0;
    const BOOL write_ok = WriteFile(
        file, content.data(), static_cast<DWORD>(content.size()), &written, nullptr);
    const BOOL flush_ok = write_ok != FALSE && written == content.size() && FlushFileBuffers(file) != FALSE;
    CloseHandle(file);
    if (flush_ok == FALSE) {
        DeleteFileW(temporary.c_str());
        return false;
    }
    if (MoveFileExW(
            temporary.c_str(), path.c_str(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) == FALSE) {
        DeleteFileW(temporary.c_str());
        return false;
    }
    return true;
}

HRESULT LoadAutomationTypeInfo(ITypeInfo** type_info) {
    if (type_info == nullptr) {
        return E_POINTER;
    }
    *type_info = nullptr;
    wchar_t module_path[32768]{};
    const DWORD length = GetModuleFileNameW(g_module, module_path, 32768);
    if (length == 0 || length >= 32768) {
        return HRESULT_FROM_WIN32(GetLastError());
    }
    std::wstring type_library_path(module_path, length);
    const std::size_t separator = type_library_path.find_last_of(L"\\/");
    if (separator == std::wstring::npos) {
        return HRESULT_FROM_WIN32(ERROR_PATH_NOT_FOUND);
    }
    type_library_path.erase(separator + 1);
    type_library_path += L"WpsHsmNativeDialogProbe.tlb";

    ITypeLib* type_library = nullptr;
    HRESULT status = LoadTypeLibEx(
        type_library_path.c_str(), REGKIND_NONE, &type_library);
    if (FAILED(status) || type_library == nullptr) {
        return status;
    }
    status = type_library->GetTypeInfoOfGuid(
        kNativeDialogAutomationId, type_info);
    type_library->Release();
    return status;
}

struct DialogState {
    HWND owner = nullptr;
    HWND edit = nullptr;
    const wchar_t* prompt = nullptr;
    const wchar_t* initial = nullptr;
    std::uint32_t max_chars = 0;
    int status = 0;
    std::wstring result;
};

void ApplyDefaultFont(HWND control) {
    if (control != nullptr) {
        SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(GetStockObject(DEFAULT_GUI_FONT)), TRUE);
    }
}

void CenterOnOwner(HWND window, HWND owner) {
    RECT target{};
    RECT dialog{};
    if (owner == nullptr || !GetWindowRect(owner, &target)) {
        SystemParametersInfoW(SPI_GETWORKAREA, 0, &target, 0);
    }
    GetWindowRect(window, &dialog);
    const int width = dialog.right - dialog.left;
    const int height = dialog.bottom - dialog.top;
    const int x = target.left + std::max(0L, ((target.right - target.left) - width) / 2);
    const int y = target.top + std::max(0L, ((target.bottom - target.top) - height) / 2);
    SetWindowPos(window, HWND_TOP, x, y, 0, 0, SWP_NOSIZE | SWP_NOACTIVATE);
}

DialogState* GetDialogState(HWND window) {
    return reinterpret_cast<DialogState*>(GetWindowLongPtrW(window, GWLP_USERDATA));
}

LRESULT CALLBACK DialogWindowProc(HWND window, UINT message, WPARAM w_param, LPARAM l_param) {
    if (message == WM_NCCREATE) {
        const auto* create = reinterpret_cast<const CREATESTRUCTW*>(l_param);
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(create->lpCreateParams));
    }
    DialogState* state = GetDialogState(window);
    switch (message) {
    case WM_CREATE: {
        if (state == nullptr) {
            return -1;
        }
        HWND label = CreateWindowExW(
            0, L"STATIC", state->prompt == nullptr ? L"" : state->prompt,
            WS_CHILD | WS_VISIBLE,
            20, 18, 500, 38, window, nullptr, g_module, nullptr);
        state->edit = CreateWindowExW(
            WS_EX_CLIENTEDGE, L"EDIT", state->initial == nullptr ? L"" : state->initial,
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | WS_VSCROLL | ES_MULTILINE | ES_AUTOVSCROLL | ES_WANTRETURN,
            20, 62, 500, 118, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kEditId)), g_module, nullptr);
        HWND ok_button = CreateWindowExW(
            0, L"BUTTON", L"确定",
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON,
            336, 198, 88, 30, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(IDOK)), g_module, nullptr);
        HWND cancel_button = CreateWindowExW(
            0, L"BUTTON", L"取消",
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON,
            432, 198, 88, 30, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(IDCANCEL)), g_module, nullptr);
        if (label == nullptr || state->edit == nullptr || ok_button == nullptr || cancel_button == nullptr) {
            return -1;
        }
        ApplyDefaultFont(label);
        ApplyDefaultFont(state->edit);
        ApplyDefaultFont(ok_button);
        ApplyDefaultFont(cancel_button);
        SendMessageW(state->edit, EM_SETLIMITTEXT, state->max_chars, 0);
        SendMessageW(state->edit, EM_SETSEL, 0, -1);
        SetFocus(state->edit);
        return 0;
    }
    case WM_COMMAND:
        if (state == nullptr) {
            break;
        }
        if (LOWORD(w_param) == IDOK) {
            const int length = GetWindowTextLengthW(state->edit);
            std::wstring value(static_cast<std::size_t>(std::max(0, length)) + 1U, L'\0');
            if (length > 0) {
                GetWindowTextW(state->edit, &value[0], length + 1);
            }
            value.resize(static_cast<std::size_t>(std::max(0, length)));
            state->result = value;
            state->status = 1;
            DestroyWindow(window);
            return 0;
        }
        if (LOWORD(w_param) == IDCANCEL) {
            state->result.clear();
            state->status = 0;
            DestroyWindow(window);
            return 0;
        }
        break;
    case WM_CLOSE:
        if (state != nullptr) {
            state->result.clear();
            state->status = 0;
        }
        DestroyWindow(window);
        return 0;
    default:
        break;
    }
    return DefWindowProcW(window, message, w_param, l_param);
}

bool EnsureWindowClass() {
    WNDCLASSEXW existing{};
    existing.cbSize = sizeof(existing);
    if (GetClassInfoExW(g_module, kWindowClass, &existing)) {
        return true;
    }
    WNDCLASSEXW window_class{};
    window_class.cbSize = sizeof(window_class);
    window_class.lpfnWndProc = DialogWindowProc;
    window_class.hInstance = g_module;
    window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    window_class.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
    window_class.lpszClassName = kWindowClass;
    return RegisterClassExW(&window_class) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
}

HRESULT GetDispatchId(IDispatch* dispatch, const wchar_t* name, DISPID* id) {
    if (dispatch == nullptr || name == nullptr || id == nullptr) {
        return E_POINTER;
    }
    LPOLESTR mutable_name = const_cast<LPOLESTR>(name);
    return dispatch->GetIDsOfNames(IID_NULL, &mutable_name, 1, LOCALE_USER_DEFAULT, id);
}

HRESULT GetDispatchProperty(IDispatch* dispatch, const wchar_t* name, VARIANT* value) {
    if (value == nullptr) {
        return E_POINTER;
    }
    VariantInit(value);
    DISPID id = DISPID_UNKNOWN;
    HRESULT result = GetDispatchId(dispatch, name, &id);
    if (FAILED(result)) {
        return result;
    }
    DISPPARAMS parameters{};
    return dispatch->Invoke(id, IID_NULL, LOCALE_USER_DEFAULT, DISPATCH_PROPERTYGET, &parameters, value, nullptr, nullptr);
}

HRESULT SetDispatchObjectProperty(IDispatch* dispatch, const wchar_t* name, IDispatch* value) {
    DISPID id = DISPID_UNKNOWN;
    HRESULT result = GetDispatchId(dispatch, name, &id);
    if (FAILED(result)) {
        return result;
    }
    VARIANTARG argument{};
    VariantInit(&argument);
    argument.vt = VT_DISPATCH;
    argument.pdispVal = value;
    if (value != nullptr) {
        value->AddRef();
    }
    DISPID named = DISPID_PROPERTYPUT;
    DISPPARAMS parameters{&argument, &named, 1, 1};
    result = dispatch->Invoke(id, IID_NULL, LOCALE_USER_DEFAULT, DISPATCH_PROPERTYPUT, &parameters, nullptr, nullptr, nullptr);
    if (FAILED(result)) {
        result = dispatch->Invoke(id, IID_NULL, LOCALE_USER_DEFAULT, DISPATCH_PROPERTYPUTREF, &parameters, nullptr, nullptr, nullptr);
    }
    VariantClear(&argument);
    return result;
}

std::wstring HresultText(const wchar_t* prefix, HRESULT result) {
    wchar_t buffer[96]{};
    swprintf_s(buffer, L"%ls HRESULT=0x%08lX", prefix, static_cast<unsigned long>(result));
    return buffer;
}

std::wstring VariantString(const VARIANTARG& source) {
    VARIANT converted{};
    VariantInit(&converted);
    if (FAILED(VariantChangeType(&converted, const_cast<VARIANTARG*>(&source), 0, VT_BSTR))) {
        return std::wstring();
    }
    std::wstring result = converted.bstrVal == nullptr ? L"" : converted.bstrVal;
    VariantClear(&converted);
    return result;
}

LONG VariantLong(const VARIANTARG& source, LONG fallback) {
    VARIANT converted{};
    VariantInit(&converted);
    if (FAILED(VariantChangeType(&converted, const_cast<VARIANTARG*>(&source), 0, VT_I4))) {
        return fallback;
    }
    const LONG result = converted.lVal;
    VariantClear(&converted);
    return result;
}

IDispatch* VariantDispatch(const VARIANTARG& source) {
    if (source.vt == VT_DISPATCH && source.pdispVal != nullptr) {
        return source.pdispVal;
    }
    if (source.vt == VT_UNKNOWN && source.punkVal != nullptr) {
        IDispatch* result = nullptr;
        if (SUCCEEDED(source.punkVal->QueryInterface(IID_IDispatch, reinterpret_cast<void**>(&result)))) {
            return result;
        }
    }
    return nullptr;
}

void SetVariantString(VARIANT* result, const std::wstring& value) {
    if (result == nullptr) {
        return;
    }
    VariantInit(result);
    result->vt = VT_BSTR;
    result->bstrVal = SysAllocStringLen(value.data(), static_cast<UINT>(value.size()));
}

class ProbeAddIn final : public IDTExtensibility2 {
public:
    ProbeAddIn() : references_(1) {
        AppendComLoadTrace("ProbeAddIn.constructor");
        type_info_status_ = LoadAutomationTypeInfo(&automation_type_info_);
        if (FAILED(type_info_status_)) {
            last_error_ = HresultText(L"Automation type library load failed", type_info_status_);
        }
        InterlockedIncrement(&g_object_count);
    }

    ~ProbeAddIn() {
        StopCommandTimer();
        SecureClearResult();
        ReleaseHostReferences();
        if (automation_type_info_ != nullptr) {
            automation_type_info_->Release();
            automation_type_info_ = nullptr;
        }
        InterlockedDecrement(&g_object_count);
    }

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** result) override {
        if (result == nullptr) {
            return E_POINTER;
        }
        *result = nullptr;
        if (iid == IID_IUnknown || iid == IID_IDispatch ||
            iid == kIdtExtensibility2Id || iid == kNativeDialogAutomationId) {
            *result = static_cast<IDTExtensibility2*>(this);
            AddRef();
            return S_OK;
        }
        return E_NOINTERFACE;
    }

    ULONG STDMETHODCALLTYPE AddRef() override {
        return static_cast<ULONG>(InterlockedIncrement(&references_));
    }

    ULONG STDMETHODCALLTYPE Release() override {
        const LONG value = InterlockedDecrement(&references_);
        if (value == 0) {
            delete this;
        }
        return static_cast<ULONG>(value);
    }

    HRESULT STDMETHODCALLTYPE GetTypeInfoCount(UINT* count) override {
        if (count == nullptr) {
            return E_POINTER;
        }
        *count = automation_type_info_ == nullptr ? 0U : 1U;
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE GetTypeInfo(UINT index, LCID, ITypeInfo** type_info) override {
        if (type_info == nullptr) {
            return E_POINTER;
        }
        *type_info = nullptr;
        if (index != 0) {
            return DISP_E_BADINDEX;
        }
        if (automation_type_info_ == nullptr) {
            return E_NOTIMPL;
        }
        automation_type_info_->AddRef();
        *type_info = automation_type_info_;
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE GetIDsOfNames(REFIID, LPOLESTR* names, UINT count, LCID, DISPID* ids) override {
        if (names == nullptr || ids == nullptr) {
            return E_POINTER;
        }
        for (UINT index = 0; index < count; ++index) {
            const wchar_t* name = names[index];
            if (_wcsicmp(name, L"OnConnection") == 0) ids[index] = 1;
            else if (_wcsicmp(name, L"OnDisconnection") == 0) ids[index] = 2;
            else if (_wcsicmp(name, L"OnAddInsUpdate") == 0) ids[index] = 3;
            else if (_wcsicmp(name, L"OnStartupComplete") == 0) ids[index] = 4;
            else if (_wcsicmp(name, L"OnBeginShutdown") == 0) ids[index] = 5;
            else if (_wcsicmp(name, L"GetBridgeVersion") == 0) ids[index] = kDispGetBridgeVersion;
            else if (_wcsicmp(name, L"GetProcessId") == 0) ids[index] = kDispGetProcessId;
            else if (_wcsicmp(name, L"GetProcessName") == 0) ids[index] = kDispGetProcessName;
            else if (_wcsicmp(name, L"ShowInputDialog") == 0) ids[index] = kDispShowInputDialog;
            else if (_wcsicmp(name, L"GetLastResult") == 0) ids[index] = kDispGetLastResult;
            else if (_wcsicmp(name, L"GetLastResultLength") == 0) ids[index] = kDispGetLastResultLength;
            else if (_wcsicmp(name, L"ClearResult") == 0) ids[index] = kDispClearResult;
            else if (_wcsicmp(name, L"GetLastError") == 0) ids[index] = kDispGetLastError;
            else return DISP_E_UNKNOWNNAME;
        }
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE Invoke(
        DISPID member,
        REFIID,
        LCID,
        WORD flags,
        DISPPARAMS* parameters,
        VARIANT* result,
        EXCEPINFO*,
        UINT* argument_error) override {
        if (argument_error != nullptr) {
            *argument_error = 0;
        }
        if (result != nullptr) {
            VariantInit(result);
        }
        if ((flags & DISPATCH_METHOD) == 0) {
            return DISP_E_MEMBERNOTFOUND;
        }
        switch (member) {
        case 1:
            if (parameters == nullptr || parameters->cArgs < 3) return DISP_E_BADPARAMCOUNT;
            return OnConnection(
                VariantDispatch(parameters->rgvarg[parameters->cArgs - 1]),
                static_cast<ExtConnectMode>(VariantLong(parameters->rgvarg[parameters->cArgs - 2], 0)),
                VariantDispatch(parameters->rgvarg[parameters->cArgs - 3]),
                nullptr);
        case 2:
            return OnDisconnection(ExtUserClosed, nullptr);
        case 3:
            return OnAddInsUpdate(nullptr);
        case 4:
            return OnStartupComplete(nullptr);
        case 5:
            return OnBeginShutdown(nullptr);
        case kDispGetBridgeVersion:
            SetVariantString(result, L"1.1-file-channel");
            return S_OK;
        case kDispGetProcessId:
            if (result != nullptr) {
                result->vt = VT_I4;
                result->lVal = static_cast<LONG>(GetCurrentProcessId());
            }
            return S_OK;
        case kDispGetProcessName:
            SetVariantString(result, ProcessName());
            return S_OK;
        case kDispShowInputDialog:
            if (parameters == nullptr || parameters->cArgs != 4) return DISP_E_BADPARAMCOUNT;
            if (result != nullptr) {
                result->vt = VT_I4;
                result->lVal = ShowInputDialog(
                    VariantString(parameters->rgvarg[3]),
                    VariantString(parameters->rgvarg[2]),
                    VariantString(parameters->rgvarg[1]),
                    VariantLong(parameters->rgvarg[0], 256));
            }
            return S_OK;
        case kDispGetLastResult:
            SetVariantString(result, last_result_);
            return S_OK;
        case kDispGetLastResultLength:
            if (result != nullptr) {
                result->vt = VT_I4;
                result->lVal = static_cast<LONG>(last_result_.size());
            }
            return S_OK;
        case kDispClearResult:
            SecureClearResult();
            return S_OK;
        case kDispGetLastError:
            SetVariantString(result, last_error_);
            return S_OK;
        default:
            return DISP_E_MEMBERNOTFOUND;
        }
    }

    HRESULT STDMETHODCALLTYPE OnConnection(
        IDispatch* application,
        ExtConnectMode,
        IDispatch* add_in_instance,
        SAFEARRAY**) override {
        AppendComLoadTrace("ProbeAddIn.OnConnection");
        ReleaseHostReferences();
        application_ = application;
        add_in_instance_ = add_in_instance;
        if (application_ != nullptr) application_->AddRef();
        if (add_in_instance_ != nullptr) add_in_instance_->AddRef();
        const HRESULT publish_status = PublishAutomationObject();
        StartCommandTimer();
        return publish_status;
    }

    HRESULT STDMETHODCALLTYPE OnDisconnection(ExtDisconnectMode, SAFEARRAY**) override {
        StopCommandTimer();
        SecureClearResult();
        ReleaseHostReferences();
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnAddInsUpdate(SAFEARRAY**) override {
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE OnStartupComplete(SAFEARRAY**) override {
        AppendComLoadTrace("ProbeAddIn.OnStartupComplete");
        const HRESULT publish_status = PublishAutomationObject();
        StartCommandTimer();
        return publish_status;
    }

    HRESULT STDMETHODCALLTYPE OnBeginShutdown(SAFEARRAY**) override {
        StopCommandTimer();
        SecureClearResult();
        return S_OK;
    }

private:
    static void CALLBACK CommandTimerProc(HWND, UINT, UINT_PTR timer_id, DWORD) {
        auto* instance = reinterpret_cast<ProbeAddIn*>(timer_id);
        if (instance != nullptr) {
            instance->PollCommandFile();
        }
    }

    void StartCommandTimer() {
        if (timer_id_ != 0 || application_ == nullptr) {
            return;
        }
        timer_window_ = HostWindow();
        if (timer_window_ == nullptr) {
            last_error_ = L"WPS host window is unavailable for the command timer";
            return;
        }
        timer_id_ = reinterpret_cast<UINT_PTR>(this);
        if (SetTimer(timer_window_, timer_id_, 200, CommandTimerProc) == 0) {
            timer_id_ = 0;
            timer_window_ = nullptr;
            last_error_ = L"SetTimer failed for the native command channel";
        }
    }

    void StopCommandTimer() {
        if (timer_id_ != 0 && timer_window_ != nullptr) {
            KillTimer(timer_window_, timer_id_);
        }
        timer_id_ = 0;
        timer_window_ = nullptr;
        command_busy_ = false;
    }

    void PollCommandFile() {
        if (command_busy_) {
            return;
        }
        const std::wstring process_name = ProcessName();
        if (process_name != L"wps" && process_name != L"wpp") {
            return;
        }
        const std::wstring request_path = ChannelFilePath(process_name, false);
        std::string request;
        if (request_path.empty() || !ReadSmallAsciiFile(request_path, &request)) {
            return;
        }
        if (ReadAsciiField(request, "schema") != "HSMCOM1" ||
            ReadAsciiField(request, "action") != "probe-input" ||
            ReadAsciiField(request, "host") != WideToUtf8(process_name) ||
            ReadAsciiField(request, "end") != "1") {
            return;
        }
        const std::string nonce = ReadAsciiField(request, "nonce");
        if (!IsSafeToken(nonce) || nonce == last_command_nonce_) {
            return;
        }
        last_command_nonce_ = nonce;
        command_busy_ = true;
        const LONG status = ShowInputDialog(
            L"高中数学原生能力探针",
            L"原生 COM DLL 已在当前 WPS 进程内运行。请输入验收文本：",
            L"HSM-COM-中文-1234567890",
            4096);
        const std::size_t result_length = last_result_.size();
        SecureClearResult();
        const bool cleared = last_result_.empty();

        std::string response = "schema=HSMCOM1\n";
        response += "nonce=" + nonce + "\n";
        response += "status=" + std::to_string(status) + "\n";
        response += "pid=" + std::to_string(GetCurrentProcessId()) + "\n";
        response += "process=" + WideToUtf8(process_name) + "\n";
        response += "resultLength=" + std::to_string(result_length) + "\n";
        response += std::string("sensitiveBufferCleared=") + (cleared ? "true\n" : "false\n");
        response += "bridgeVersion=1.1-file-channel\n";
        response += "error=" + SingleLineUtf8(last_error_) + "\n";
        response += "end=1\n";
        if (!WriteAtomicAsciiFile(ChannelFilePath(process_name, true), response)) {
            last_error_ = L"native command response write failed";
        }
        command_busy_ = false;
    }

    HRESULT PublishAutomationObject() {
        if (add_in_instance_ == nullptr) {
            last_error_ = L"COMAddIn instance is unavailable";
            return S_OK;
        }
        HRESULT result = SetDispatchObjectProperty(
            add_in_instance_, L"Object", static_cast<IDispatch*>(static_cast<IDTExtensibility2*>(this)));
        if (FAILED(result)) {
            last_error_ = HresultText(L"COMAddIn.Object publication failed", result);
            return S_OK;
        }
        last_error_.clear();
        return S_OK;
    }

    void ReleaseHostReferences() {
        if (add_in_instance_ != nullptr) {
            add_in_instance_->Release();
            add_in_instance_ = nullptr;
        }
        if (application_ != nullptr) {
            application_->Release();
            application_ = nullptr;
        }
    }

    HWND HostWindow() const {
        if (application_ != nullptr) {
            VARIANT value{};
            if (SUCCEEDED(GetDispatchProperty(application_, L"Hwnd", &value))) {
                VARIANT converted{};
                VariantInit(&converted);
                if (SUCCEEDED(VariantChangeType(&converted, &value, 0, VT_I8))) {
                    HWND window = reinterpret_cast<HWND>(static_cast<INT_PTR>(converted.llVal));
                    VariantClear(&converted);
                    VariantClear(&value);
                    if (IsWindow(window)) {
                        return window;
                    }
                } else {
                    VariantClear(&converted);
                    VariantClear(&value);
                }
            }
        }
        HWND candidates[] = {GetForegroundWindow(), GetActiveWindow()};
        for (HWND candidate : candidates) {
            DWORD process_id = 0;
            if (candidate != nullptr) {
                GetWindowThreadProcessId(candidate, &process_id);
                if (process_id == GetCurrentProcessId()) {
                    return candidate;
                }
            }
        }
        return nullptr;
    }

    LONG ShowInputDialog(
        const std::wstring& title,
        const std::wstring& prompt,
        const std::wstring& initial,
        LONG max_chars) {
        SecureClearResult();
        last_error_.clear();
        if (max_chars <= 0 || max_chars > 4096 || !EnsureWindowClass()) {
            last_error_ = L"invalid dialog limit or window class registration failed";
            return -1;
        }
        DialogState state{};
        state.owner = HostWindow();
        state.prompt = prompt.c_str();
        state.initial = initial.c_str();
        state.max_chars = static_cast<std::uint32_t>(max_chars);
        HWND dialog = CreateWindowExW(
            WS_EX_DLGMODALFRAME,
            kWindowClass,
            title.empty() ? L"高中数学原生对话框探针" : title.c_str(),
            WS_POPUP | WS_CAPTION | WS_SYSMENU,
            CW_USEDEFAULT, CW_USEDEFAULT, 556, 280,
            state.owner, nullptr, g_module, &state);
        if (dialog == nullptr) {
            last_error_ = L"CreateWindowExW failed";
            return -2;
        }
        const bool owner_was_enabled = state.owner != nullptr && IsWindowEnabled(state.owner);
        if (owner_was_enabled) EnableWindow(state.owner, FALSE);
        CenterOnOwner(dialog, state.owner);
        ShowWindow(dialog, SW_SHOW);
        UpdateWindow(dialog);
        MSG message{};
        int loop_status = 1;
        while (IsWindow(dialog) && (loop_status = GetMessageW(&message, nullptr, 0, 0)) > 0) {
            if (!IsDialogMessageW(dialog, &message)) {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        if (owner_was_enabled && state.owner != nullptr) {
            EnableWindow(state.owner, TRUE);
            SetForegroundWindow(state.owner);
        }
        if (loop_status < 0) {
            state.status = -3;
            state.result.clear();
            last_error_ = L"dialog message loop failed";
        }
        if (state.status == 1) {
            last_result_ = state.result;
        }
        if (!state.result.empty()) {
            SecureZeroMemory(&state.result[0], state.result.size() * sizeof(wchar_t));
            state.result.clear();
        }
        return state.status;
    }

    std::wstring ProcessName() const {
        wchar_t path[MAX_PATH]{};
        const DWORD length = GetModuleFileNameW(nullptr, path, MAX_PATH);
        std::wstring name(path, length);
        const std::size_t slash = name.find_last_of(L"\\/");
        if (slash != std::wstring::npos) name.erase(0, slash + 1);
        const std::size_t extension = name.find_last_of(L'.');
        if (extension != std::wstring::npos) name.erase(extension);
        for (wchar_t& character : name) character = static_cast<wchar_t>(towlower(character));
        return name;
    }

    void SecureClearResult() {
        if (!last_result_.empty()) {
            SecureZeroMemory(&last_result_[0], last_result_.size() * sizeof(wchar_t));
            last_result_.clear();
        }
    }

    LONG references_;
    ITypeInfo* automation_type_info_ = nullptr;
    HRESULT type_info_status_ = E_PENDING;
    IDispatch* application_ = nullptr;
    IDispatch* add_in_instance_ = nullptr;
    HWND timer_window_ = nullptr;
    UINT_PTR timer_id_ = 0;
    bool command_busy_ = false;
    std::string last_command_nonce_;
    std::wstring last_result_;
    std::wstring last_error_;
};

class ProbeClassFactory final : public IClassFactory {
public:
    ProbeClassFactory() : references_(1) {}

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** result) override {
        if (result == nullptr) return E_POINTER;
        *result = nullptr;
        if (iid == IID_IUnknown || iid == IID_IClassFactory) {
            *result = static_cast<IClassFactory*>(this);
            AddRef();
            return S_OK;
        }
        return E_NOINTERFACE;
    }

    ULONG STDMETHODCALLTYPE AddRef() override {
        return static_cast<ULONG>(InterlockedIncrement(&references_));
    }

    ULONG STDMETHODCALLTYPE Release() override {
        const LONG value = InterlockedDecrement(&references_);
        if (value == 0) delete this;
        return static_cast<ULONG>(value);
    }

    HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer, REFIID iid, void** result) override {
        AppendComLoadTrace("ProbeClassFactory.CreateInstance");
        if (result == nullptr) return E_POINTER;
        *result = nullptr;
        if (outer != nullptr) return CLASS_E_NOAGGREGATION;
        ProbeAddIn* instance = new (std::nothrow) ProbeAddIn();
        if (instance == nullptr) return E_OUTOFMEMORY;
        const HRESULT status = instance->QueryInterface(iid, result);
        instance->Release();
        return status;
    }

    HRESULT STDMETHODCALLTYPE LockServer(BOOL lock) override {
        if (lock) InterlockedIncrement(&g_server_locks);
        else InterlockedDecrement(&g_server_locks);
        return S_OK;
    }

private:
    LONG references_;
};

}  // namespace

extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID class_id, REFIID iid, void** result) {
    AppendComLoadTrace("DllGetClassObject");
    if (result == nullptr) return E_POINTER;
    *result = nullptr;
    if (class_id != kProbeClassId) return CLASS_E_CLASSNOTAVAILABLE;
    ProbeClassFactory* factory = new (std::nothrow) ProbeClassFactory();
    if (factory == nullptr) return E_OUTOFMEMORY;
    const HRESULT status = factory->QueryInterface(iid, result);
    factory->Release();
    return status;
}

extern "C" HRESULT __stdcall DllCanUnloadNow() {
    return (g_object_count == 0 && g_server_locks == 0) ? S_OK : S_FALSE;
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        g_module = instance;
        DisableThreadLibraryCalls(instance);
    }
    return TRUE;
}
