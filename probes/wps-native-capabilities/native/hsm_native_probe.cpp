#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

#include <algorithm>
#include <cstdint>
#include <string>

namespace {

constexpr wchar_t kWindowClass[] = L"WpsHsmNativeDialogProbeV1";
constexpr int kEditId = 1001;

HINSTANCE g_module = nullptr;
thread_local std::wstring g_last_result;

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

DialogState* GetState(HWND window) {
    return reinterpret_cast<DialogState*>(GetWindowLongPtrW(window, GWLP_USERDATA));
}

LRESULT CALLBACK DialogWindowProc(HWND window, UINT message, WPARAM w_param, LPARAM l_param) {
    if (message == WM_NCCREATE) {
        const auto* create = reinterpret_cast<const CREATESTRUCTW*>(l_param);
        SetWindowLongPtrW(window, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(create->lpCreateParams));
    }

    DialogState* state = GetState(window);
    switch (message) {
    case WM_CREATE: {
        if (state == nullptr) {
            return -1;
        }
        HWND label = CreateWindowExW(
            0, L"STATIC", state->prompt == nullptr ? L"" : state->prompt,
            WS_CHILD | WS_VISIBLE,
            20, 18, 500, 36, window, nullptr, g_module, nullptr);
        state->edit = CreateWindowExW(
            WS_EX_CLIENTEDGE, L"EDIT", state->initial == nullptr ? L"" : state->initial,
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_AUTOHSCROLL,
            20, 58, 500, 27, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(kEditId)), g_module, nullptr);
        HWND ok_button = CreateWindowExW(
            0, L"BUTTON", L"确定",
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON,
            336, 108, 88, 30, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(IDOK)), g_module, nullptr);
        HWND cancel_button = CreateWindowExW(
            0, L"BUTTON", L"取消",
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON,
            432, 108, 88, 30, window, reinterpret_cast<HMENU>(static_cast<INT_PTR>(IDCANCEL)), g_module, nullptr);
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

HWND FindHostOwner() {
    HWND candidates[] = {GetForegroundWindow(), GetActiveWindow()};
    for (HWND candidate : candidates) {
        if (candidate == nullptr) {
            continue;
        }
        DWORD process_id = 0;
        GetWindowThreadProcessId(candidate, &process_id);
        if (process_id == GetCurrentProcessId()) {
            return candidate;
        }
    }
    return nullptr;
}

void SecureClearLastResult() {
    if (!g_last_result.empty()) {
        SecureZeroMemory(&g_last_result[0], g_last_result.size() * sizeof(wchar_t));
        g_last_result.clear();
    }
}

std::string CurrentProcessName() {
    wchar_t path[MAX_PATH]{};
    const DWORD length = GetModuleFileNameW(nullptr, path, MAX_PATH);
    const wchar_t* name = path;
    if (length > 0 && length < MAX_PATH) {
        for (const wchar_t* cursor = path; *cursor != L'\0'; ++cursor) {
            if (*cursor == L'\\' || *cursor == L'/') {
                name = cursor + 1;
            }
        }
    }
    std::string result;
    while (*name != L'\0') {
        const wchar_t value = *name++;
        result.push_back(value >= 0 && value <= 0x7f ? static_cast<char>(value) : '?');
    }
    return result;
}

void WriteNativeXAudit(int status, std::size_t result_length) {
    wchar_t app_data[32768]{};
    const DWORD length = GetEnvironmentVariableW(L"APPDATA", app_data, 32768);
    if (length == 0 || length >= 32768) {
        return;
    }

    std::wstring product_root(app_data);
    product_root += L"\\WpsHighSchoolMath";
    std::wstring probe_root = product_root + L"\\native-capability-probe";
    CreateDirectoryW(product_root.c_str(), nullptr);
    CreateDirectoryW(probe_root.c_str(), nullptr);
    const std::wstring audit_path = probe_root + L"\\nativex-result.txt";

    std::string content =
        "schema=HSMNATIVEX1\nstatus=" + std::to_string(status) +
        "\npid=" + std::to_string(GetCurrentProcessId()) +
        "\nprocess=" + CurrentProcessName() +
        "\nresultLength=" + std::to_string(result_length) +
        "\nsensitiveBufferCleared=true\n";
    HANDLE file = CreateFileW(
        audit_path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        return;
    }
    DWORD written = 0;
    WriteFile(file, content.data(), static_cast<DWORD>(content.size()), &written, nullptr);
    FlushFileBuffers(file);
    CloseHandle(file);
}

}  // namespace

extern "C" __declspec(dllexport) int __cdecl HsmProbeShowInputDialog(
    const wchar_t* title,
    const wchar_t* prompt,
    const wchar_t* initial,
    std::uint32_t max_chars);

// WPS NativeX loads registered modules in-process and resolves this fixed entry
// point.  The SDK object bridge is deliberately not returned by this hard-gate
// probe: displaying the modal Win32 dialog is sufficient to prove that WPS has
// loaded and executed our native code in its own process.
extern "C" __declspec(dllexport) void* __cdecl OnWpsLoad() {
    const int status = HsmProbeShowInputDialog(
        L"高中数学原生能力探针",
        L"NativeX 已在当前 WPS 进程内运行。请输入验收文本：",
        L"HSM-NATIVEX-中文-1234567890",
        4096);
    const std::size_t result_length = g_last_result.size();
    SecureClearLastResult();
    WriteNativeXAudit(status, result_length);
    return nullptr;
}

extern "C" __declspec(dllexport) const wchar_t* __cdecl HsmProbeGetBridgeVersion() {
    return L"1.1.0-nativex-probe";
}

extern "C" __declspec(dllexport) std::uint32_t __cdecl HsmProbeGetProcessId() {
    return static_cast<std::uint32_t>(GetCurrentProcessId());
}

extern "C" __declspec(dllexport) int __cdecl HsmProbeShowInputDialog(
    const wchar_t* title,
    const wchar_t* prompt,
    const wchar_t* initial,
    std::uint32_t max_chars) {
    SecureClearLastResult();
    if (max_chars == 0 || max_chars > 4096 || !EnsureWindowClass()) {
        return -1;
    }

    DialogState state{};
    state.owner = FindHostOwner();
    state.prompt = prompt;
    state.initial = initial;
    state.max_chars = max_chars;

    HWND dialog = CreateWindowExW(
        WS_EX_DLGMODALFRAME,
        kWindowClass,
        (title == nullptr || title[0] == L'\0') ? L"高中数学原生对话框探针" : title,
        WS_POPUP | WS_CAPTION | WS_SYSMENU,
        CW_USEDEFAULT, CW_USEDEFAULT, 556, 190,
        state.owner, nullptr, g_module, &state);
    if (dialog == nullptr) {
        return -2;
    }

    const bool owner_was_enabled = state.owner != nullptr && IsWindowEnabled(state.owner);
    if (owner_was_enabled) {
        EnableWindow(state.owner, FALSE);
    }
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
    }
    if (state.status == 1) {
        g_last_result = state.result;
    }
    if (!state.result.empty()) {
        SecureZeroMemory(&state.result[0], state.result.size() * sizeof(wchar_t));
        state.result.clear();
    }
    return state.status;
}

extern "C" __declspec(dllexport) const wchar_t* __cdecl HsmProbeGetLastResult() {
    return g_last_result.c_str();
}

extern "C" __declspec(dllexport) std::uint32_t __cdecl HsmProbeGetLastResultLength() {
    return static_cast<std::uint32_t>(g_last_result.size());
}

extern "C" __declspec(dllexport) void __cdecl HsmProbeClearResult() {
    SecureClearLastResult();
}

BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        g_module = instance;
        DisableThreadLibraryCalls(instance);
    }
    return TRUE;
}
