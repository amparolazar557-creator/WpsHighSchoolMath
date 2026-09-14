#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <oaidl.h>

#include <cstdio>
#include <cwchar>

namespace {

const CLSID kProbeClassId = {
    0x76F85F17, 0x71B3, 0x40E2, {0xA4, 0xCD, 0x50, 0xB7, 0x69, 0xFA, 0x37, 0xA7}};

void PrintStatus(const char* label, HRESULT status) {
    std::printf("%s=0x%08lX\n", label, static_cast<unsigned long>(status));
}

}  // namespace

int wmain() {
    HRESULT status = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    PrintStatus("CoInitializeEx", status);
    if (FAILED(status)) {
        return 1;
    }

    IDispatch* dispatch = nullptr;
    status = CoCreateInstance(
        kProbeClassId, nullptr, CLSCTX_INPROC_SERVER, IID_IDispatch,
        reinterpret_cast<void**>(&dispatch));
    PrintStatus("CoCreateInstance", status);
    if (FAILED(status) || dispatch == nullptr) {
        CoUninitialize();
        return 2;
    }

    UINT count = 0;
    status = dispatch->GetTypeInfoCount(&count);
    PrintStatus("GetTypeInfoCount", status);
    std::printf("typeInfoCount=%u\n", count);

    ITypeInfo* type_info = nullptr;
    status = dispatch->GetTypeInfo(0, LOCALE_SYSTEM_DEFAULT, &type_info);
    PrintStatus("GetTypeInfo", status);
    std::printf("typeInfoPointer=%p\n", static_cast<void*>(type_info));
    if (SUCCEEDED(status) && type_info != nullptr) {
        TYPEATTR* attributes = nullptr;
        status = type_info->GetTypeAttr(&attributes);
        PrintStatus("GetTypeAttr", status);
        std::printf("typeAttrPointer=%p\n", static_cast<void*>(attributes));
        if (attributes != nullptr) {
            std::printf(
                "typeKind=%d functions=%u variables=%u vtableBytes=%u\n",
                static_cast<int>(attributes->typekind),
                attributes->cFuncs,
                attributes->cVars,
                attributes->cbSizeVft);
            type_info->ReleaseTypeAttr(attributes);
        }
        type_info->Release();
    }

    LPOLESTR method_name = const_cast<LPOLESTR>(L"GetBridgeVersion");
    DISPID method_id = DISPID_UNKNOWN;
    status = dispatch->GetIDsOfNames(
        IID_NULL, &method_name, 1, LOCALE_SYSTEM_DEFAULT, &method_id);
    PrintStatus("GetIDsOfNames", status);
    std::printf("methodId=%ld\n", static_cast<long>(method_id));
    if (SUCCEEDED(status)) {
        DISPPARAMS parameters{};
        VARIANT result{};
        VariantInit(&result);
        status = dispatch->Invoke(
            method_id, IID_NULL, LOCALE_SYSTEM_DEFAULT, DISPATCH_METHOD,
            &parameters, &result, nullptr, nullptr);
        PrintStatus("Invoke", status);
        std::wprintf(
            L"resultType=%u result=%ls\n",
            static_cast<unsigned>(result.vt),
            result.vt == VT_BSTR && result.bstrVal != nullptr ? result.bstrVal : L"");
        VariantClear(&result);
    }

    dispatch->Release();
    CoUninitialize();
    return 0;
}
