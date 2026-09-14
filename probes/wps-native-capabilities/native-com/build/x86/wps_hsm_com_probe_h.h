

/* this ALWAYS GENERATED file contains the definitions for the interfaces */


 /* File created by MIDL compiler version 8.01.0628 */
/* at Tue Jan 19 11:14:07 2038
 */
/* Compiler settings for C:\Users\17852\Documents\สýัง\probes\wps-native-capabilities\native-com\wps_hsm_com_probe.idl:
    Oicf, W1, Zp8, env=Win32 (32b run), target_arch=X86 8.01.0628 
    protocol : dce , ms_ext, c_ext, robust
    error checks: allocation ref bounds_check enum stub_data 
    VC __declspec() decoration level: 
         __declspec(uuid()), __declspec(selectany), __declspec(novtable)
         DECLSPEC_UUID(), MIDL_INTERFACE()
*/
/* @@MIDL_FILE_HEADING(  ) */

#pragma warning( disable: 4049 )  /* more than 64k source lines */


/* verify that the <rpcndr.h> version is high enough to compile this file*/
#ifndef __REQUIRED_RPCNDR_H_VERSION__
#define __REQUIRED_RPCNDR_H_VERSION__ 475
#endif

#include "rpc.h"
#include "rpcndr.h"

#ifndef __RPCNDR_H_VERSION__
#error this stub requires an updated version of <rpcndr.h>
#endif /* __RPCNDR_H_VERSION__ */


#ifndef __wps_hsm_com_probe_h_h__
#define __wps_hsm_com_probe_h_h__

#if defined(_MSC_VER) && (_MSC_VER >= 1020)
#pragma once
#endif

#ifndef DECLSPEC_XFGVIRT
#if defined(_CONTROL_FLOW_GUARD_XFG)
#define DECLSPEC_XFGVIRT(base, func) __declspec(xfg_virtual(base, func))
#else
#define DECLSPEC_XFGVIRT(base, func)
#endif
#endif

/* Forward Declarations */ 

#ifndef __IWpsHsmNativeDialogAutomation_FWD_DEFINED__
#define __IWpsHsmNativeDialogAutomation_FWD_DEFINED__
typedef interface IWpsHsmNativeDialogAutomation IWpsHsmNativeDialogAutomation;

#endif 	/* __IWpsHsmNativeDialogAutomation_FWD_DEFINED__ */


#ifndef __WpsHsmNativeDialogProbe_FWD_DEFINED__
#define __WpsHsmNativeDialogProbe_FWD_DEFINED__

#ifdef __cplusplus
typedef class WpsHsmNativeDialogProbe WpsHsmNativeDialogProbe;
#else
typedef struct WpsHsmNativeDialogProbe WpsHsmNativeDialogProbe;
#endif /* __cplusplus */

#endif 	/* __WpsHsmNativeDialogProbe_FWD_DEFINED__ */


/* header files for imported files */
#include "oaidl.h"
#include "ocidl.h"

#ifdef __cplusplus
extern "C"{
#endif 



#ifndef __WpsHsmNativeDialogProbeLib_LIBRARY_DEFINED__
#define __WpsHsmNativeDialogProbeLib_LIBRARY_DEFINED__

/* library WpsHsmNativeDialogProbeLib */
/* [helpstring][version][uuid] */ 


EXTERN_C const IID LIBID_WpsHsmNativeDialogProbeLib;

#ifndef __IWpsHsmNativeDialogAutomation_DISPINTERFACE_DEFINED__
#define __IWpsHsmNativeDialogAutomation_DISPINTERFACE_DEFINED__

/* dispinterface IWpsHsmNativeDialogAutomation */
/* [helpstring][uuid] */ 


EXTERN_C const IID DIID_IWpsHsmNativeDialogAutomation;

#if defined(__cplusplus) && !defined(CINTERFACE)

    MIDL_INTERFACE("7B4641C6-2E3B-4FBF-9611-52577CDDD0CA")
    IWpsHsmNativeDialogAutomation : public IDispatch
    {
    };
    
#else 	/* C style interface */

    typedef struct IWpsHsmNativeDialogAutomationVtbl
    {
        BEGIN_INTERFACE
        
        DECLSPEC_XFGVIRT(IUnknown, QueryInterface)
        HRESULT ( STDMETHODCALLTYPE *QueryInterface )( 
            IWpsHsmNativeDialogAutomation * This,
            /* [in] */ REFIID riid,
            /* [annotation][iid_is][out] */ 
            _COM_Outptr_  void **ppvObject);
        
        DECLSPEC_XFGVIRT(IUnknown, AddRef)
        ULONG ( STDMETHODCALLTYPE *AddRef )( 
            IWpsHsmNativeDialogAutomation * This);
        
        DECLSPEC_XFGVIRT(IUnknown, Release)
        ULONG ( STDMETHODCALLTYPE *Release )( 
            IWpsHsmNativeDialogAutomation * This);
        
        DECLSPEC_XFGVIRT(IDispatch, GetTypeInfoCount)
        HRESULT ( STDMETHODCALLTYPE *GetTypeInfoCount )( 
            IWpsHsmNativeDialogAutomation * This,
            /* [out] */ UINT *pctinfo);
        
        DECLSPEC_XFGVIRT(IDispatch, GetTypeInfo)
        HRESULT ( STDMETHODCALLTYPE *GetTypeInfo )( 
            IWpsHsmNativeDialogAutomation * This,
            /* [in] */ UINT iTInfo,
            /* [in] */ LCID lcid,
            /* [out] */ ITypeInfo **ppTInfo);
        
        DECLSPEC_XFGVIRT(IDispatch, GetIDsOfNames)
        HRESULT ( STDMETHODCALLTYPE *GetIDsOfNames )( 
            IWpsHsmNativeDialogAutomation * This,
            /* [in] */ REFIID riid,
            /* [size_is][in] */ LPOLESTR *rgszNames,
            /* [range][in] */ UINT cNames,
            /* [in] */ LCID lcid,
            /* [size_is][out] */ DISPID *rgDispId);
        
        DECLSPEC_XFGVIRT(IDispatch, Invoke)
        /* [local] */ HRESULT ( STDMETHODCALLTYPE *Invoke )( 
            IWpsHsmNativeDialogAutomation * This,
            /* [annotation][in] */ 
            _In_  DISPID dispIdMember,
            /* [annotation][in] */ 
            _In_  REFIID riid,
            /* [annotation][in] */ 
            _In_  LCID lcid,
            /* [annotation][in] */ 
            _In_  WORD wFlags,
            /* [annotation][out][in] */ 
            _In_  DISPPARAMS *pDispParams,
            /* [annotation][out] */ 
            _Out_opt_  VARIANT *pVarResult,
            /* [annotation][out] */ 
            _Out_opt_  EXCEPINFO *pExcepInfo,
            /* [annotation][out] */ 
            _Out_opt_  UINT *puArgErr);
        
        END_INTERFACE
    } IWpsHsmNativeDialogAutomationVtbl;

    interface IWpsHsmNativeDialogAutomation
    {
        CONST_VTBL struct IWpsHsmNativeDialogAutomationVtbl *lpVtbl;
    };

    

#ifdef COBJMACROS


#define IWpsHsmNativeDialogAutomation_QueryInterface(This,riid,ppvObject)	\
    ( (This)->lpVtbl -> QueryInterface(This,riid,ppvObject) ) 

#define IWpsHsmNativeDialogAutomation_AddRef(This)	\
    ( (This)->lpVtbl -> AddRef(This) ) 

#define IWpsHsmNativeDialogAutomation_Release(This)	\
    ( (This)->lpVtbl -> Release(This) ) 


#define IWpsHsmNativeDialogAutomation_GetTypeInfoCount(This,pctinfo)	\
    ( (This)->lpVtbl -> GetTypeInfoCount(This,pctinfo) ) 

#define IWpsHsmNativeDialogAutomation_GetTypeInfo(This,iTInfo,lcid,ppTInfo)	\
    ( (This)->lpVtbl -> GetTypeInfo(This,iTInfo,lcid,ppTInfo) ) 

#define IWpsHsmNativeDialogAutomation_GetIDsOfNames(This,riid,rgszNames,cNames,lcid,rgDispId)	\
    ( (This)->lpVtbl -> GetIDsOfNames(This,riid,rgszNames,cNames,lcid,rgDispId) ) 

#define IWpsHsmNativeDialogAutomation_Invoke(This,dispIdMember,riid,lcid,wFlags,pDispParams,pVarResult,pExcepInfo,puArgErr)	\
    ( (This)->lpVtbl -> Invoke(This,dispIdMember,riid,lcid,wFlags,pDispParams,pVarResult,pExcepInfo,puArgErr) ) 

#endif /* COBJMACROS */


#endif 	/* C style interface */


#endif 	/* __IWpsHsmNativeDialogAutomation_DISPINTERFACE_DEFINED__ */


EXTERN_C const CLSID CLSID_WpsHsmNativeDialogProbe;

#ifdef __cplusplus

class DECLSPEC_UUID("76F85F17-71B3-40E2-A4CD-50B769FA37A7")
WpsHsmNativeDialogProbe;
#endif
#endif /* __WpsHsmNativeDialogProbeLib_LIBRARY_DEFINED__ */

/* Additional Prototypes for ALL interfaces */

/* end of Additional Prototypes */

#ifdef __cplusplus
}
#endif

#endif


