//! Recycle-only Windows Shell operation. The progress sink vetoes permanent deletion.
use std::{
    path::Path,
    sync::{Arc, Mutex},
};
use windows::{
    core::{implement, Error, Ref, Result, HRESULT, HSTRING, PCWSTR},
    Win32::{
        Foundation::E_ABORT,
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        },
        UI::Shell::{
            FileOperation, IFileOperation, IFileOperationProgressSink,
            IFileOperationProgressSink_Impl, IShellItem, SHCreateItemFromParsingName,
            FOFX_ADDUNDORECORD, FOFX_EARLYFAILURE, FOFX_RECYCLEONDELETE, FOF_NOCONFIRMATION,
            FOF_NOERRORUI, FOF_SILENT, TSF_DELETE_RECYCLE_IF_POSSIBLE,
        },
    },
};

struct ComApartment;
impl Drop for ComApartment {
    fn drop(&mut self) {
        // SAFETY: created only after successful initialization, dropped on the same thread.
        unsafe { CoUninitialize() };
    }
}

pub(super) fn recycle(path: &Path) -> Result<()> {
    // SAFETY: this is a dedicated STA thread. All COM objects drop before the apartment.
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let _apartment = ComApartment;
        let operation: IFileOperation =
            CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)?;
        operation.SetOperationFlags(
            FOFX_RECYCLEONDELETE
                | FOFX_ADDUNDORECORD
                | FOFX_EARLYFAILURE
                | FOF_NOERRORUI
                | FOF_SILENT
                | FOF_NOCONFIRMATION,
        )?;
        // canonicalize returns a verbatim (\\?\) path that the Shell parser rejects.
        let path = HSTRING::from(dunce::simplified(path).as_os_str());
        let item: IShellItem = SHCreateItemFromParsingName(&path, None)?;
        let outcome = Arc::new(Mutex::new(None));
        let sink: IFileOperationProgressSink = RecycleSink {
            outcome: outcome.clone(),
        }
        .into();
        operation.DeleteItem(&item, &sink)?;
        operation.PerformOperations()?;
        if operation.GetAnyOperationsAborted()?.as_bool() {
            return Err(Error::from_hresult(E_ABORT));
        }
        let status = outcome.lock().map_err(|_| Error::from_hresult(E_ABORT))?;
        status.unwrap_or(E_ABORT).ok()
    }
}

#[implement(IFileOperationProgressSink)]
struct RecycleSink {
    outcome: Arc<Mutex<Option<HRESULT>>>,
}

#[allow(non_snake_case)]
impl IFileOperationProgressSink_Impl for RecycleSink_Impl {
    fn PreDeleteItem(&self, flags: u32, _: Ref<'_, IShellItem>) -> Result<()> {
        ensure_recycle(flags)
    }
    fn PostDeleteItem(
        &self,
        _: u32,
        _: Ref<'_, IShellItem>,
        result: HRESULT,
        _: Ref<'_, IShellItem>,
    ) -> Result<()> {
        *self
            .outcome
            .lock()
            .map_err(|_| Error::from_hresult(E_ABORT))? = Some(result);
        result.ok()
    }
    fn StartOperations(&self) -> Result<()> {
        Ok(())
    }
    fn FinishOperations(&self, result: HRESULT) -> Result<()> {
        result.ok()
    }
    fn PreRenameItem(&self, _: u32, _: Ref<'_, IShellItem>, _: &PCWSTR) -> Result<()> {
        Err(Error::from_hresult(E_ABORT))
    }
    fn PostRenameItem(
        &self,
        _: u32,
        _: Ref<'_, IShellItem>,
        _: &PCWSTR,
        _: HRESULT,
        _: Ref<'_, IShellItem>,
    ) -> Result<()> {
        Ok(())
    }
    fn PreMoveItem(
        &self,
        _: u32,
        _: Ref<'_, IShellItem>,
        _: Ref<'_, IShellItem>,
        _: &PCWSTR,
    ) -> Result<()> {
        Err(Error::from_hresult(E_ABORT))
    }
    fn PostMoveItem(
        &self,
        _: u32,
        _: Ref<'_, IShellItem>,
        _: Ref<'_, IShellItem>,
        _: &PCWSTR,
        _: HRESULT,
        _: Ref<'_, IShellItem>,
    ) -> Result<()> {
        Ok(())
    }
    fn PreCopyItem(
        &self,
        _: u32,
        _: Ref<'_, IShellItem>,
        _: Ref<'_, IShellItem>,
        _: &PCWSTR,
    ) -> Result<()> {
        Err(Error::from_hresult(E_ABORT))
    }
    fn PostCopyItem(
        &self,
        _: u32,
        _: Ref<'_, IShellItem>,
        _: Ref<'_, IShellItem>,
        _: &PCWSTR,
        _: HRESULT,
        _: Ref<'_, IShellItem>,
    ) -> Result<()> {
        Ok(())
    }
    fn PreNewItem(&self, _: u32, _: Ref<'_, IShellItem>, _: &PCWSTR) -> Result<()> {
        Err(Error::from_hresult(E_ABORT))
    }
    fn PostNewItem(
        &self,
        _: u32,
        _: Ref<'_, IShellItem>,
        _: &PCWSTR,
        _: &PCWSTR,
        _: u32,
        _: HRESULT,
        _: Ref<'_, IShellItem>,
    ) -> Result<()> {
        Ok(())
    }
    fn UpdateProgress(&self, _: u32, _: u32) -> Result<()> {
        Ok(())
    }
    fn ResetTimer(&self) -> Result<()> {
        Ok(())
    }
    fn PauseTimer(&self) -> Result<()> {
        Ok(())
    }
    fn ResumeTimer(&self) -> Result<()> {
        Ok(())
    }
}

fn ensure_recycle(flags: u32) -> Result<()> {
    if flags & TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32 == 0 {
        return Err(Error::from_hresult(E_ABORT));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_permanent_delete_callbacks() {
        assert!(ensure_recycle(0).is_err());
        assert!(ensure_recycle(TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32).is_ok());
    }
}
