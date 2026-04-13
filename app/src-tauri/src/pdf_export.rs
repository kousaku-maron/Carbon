use std::{
    env,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;
use uuid::Uuid;

#[cfg(target_os = "macos")]
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    sync::{Arc, Mutex},
};

#[cfg(target_os = "macos")]
use block2::{DynBlock, RcBlock};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSBackingStoreType, NSPaperOrientation, NSPrintInfo, NSPrintJobSavingURL,
    NSPrintOperation, NSPrintSaveJob, NSPrintingPaginationMode, NSWindow,
    NSWindowAnimationBehavior, NSWindowStyleMask,
};
#[cfg(target_os = "macos")]
use objc2::{
    define_class, msg_send, rc::Retained, runtime::ProtocolObject, AnyThread, DefinedClass,
    MainThreadOnly,
};
#[cfg(target_os = "macos")]
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
#[cfg(target_os = "macos")]
use objc2_foundation::{
    MainThreadMarker, NSError, NSObject, NSObjectProtocol, NSString, NSURL,
};
#[cfg(target_os = "macos")]
use objc2_web_kit::{
    WKNavigation, WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate,
    WKScriptMessage, WKScriptMessageHandler, WKUserContentController, WKWebView,
    WKWebViewConfiguration,
};

const PDF_EXPORT_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(target_os = "macos")]
const PDF_EXPORT_READY_HANDLER_NAME: &str = "carbonPdfReady";
#[cfg(target_os = "macos")]
const PDF_EXPORT_ERROR_HANDLER_NAME: &str = "carbonPdfError";

#[cfg(target_os = "macos")]
const PDF_EXPORT_PAGE_WIDTH: f64 = 595.0;
#[cfg(target_os = "macos")]
const PDF_EXPORT_PAGE_HEIGHT: f64 = 842.0;
#[cfg(target_os = "macos")]
const PDF_EXPORT_HOST_WINDOW_ORIGIN_X: f64 = 48.0;
#[cfg(target_os = "macos")]
const PDF_EXPORT_HOST_WINDOW_ORIGIN_Y: f64 = 48.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePdfExportRequest {
    pub note_name: String,
    pub vault_path: String,
    pub html_document: String,
    pub output_path: String,
}

fn sanitize_pdf_file_name(name: &str) -> String {
    let sanitized = name
        .trim()
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => ch,
        })
        .collect::<String>();

    let sanitized = sanitized.trim_matches('.').trim();
    if sanitized.is_empty() {
        "Untitled".to_string()
    } else {
        sanitized.to_string()
    }
}

fn build_pdf_output_path(
    app: &AppHandle,
    request: &NotePdfExportRequest,
) -> Result<PathBuf, String> {
    let download_dir = app
        .path()
        .download_dir()
        .map_err(|error| format!("Failed to resolve the Downloads folder: {error}"))?;

    let base_name = sanitize_pdf_file_name(&request.note_name);
    Ok(find_available_pdf_output_path(&download_dir, &base_name))
}

fn find_available_pdf_output_path(directory: &Path, base_name: &str) -> PathBuf {
    let initial_path = directory.join(format!("{base_name}.pdf"));
    if !initial_path.exists() {
        return initial_path;
    }

    let mut suffix = 1;
    loop {
        let candidate = directory.join(format!("{base_name}({suffix}).pdf"));
        if !candidate.exists() {
            return candidate;
        }
        suffix += 1;
    }
}

fn build_temp_pdf_path(target_path: &Path) -> Result<PathBuf, String> {
    let file_name = target_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Failed to derive a target PDF file name".to_string())?;
    let parent = target_path
        .parent()
        .ok_or_else(|| "Failed to derive the target PDF directory".to_string())?;
    Ok(parent.join(format!(".{file_name}.carbon-export-{}.tmp", Uuid::new_v4())))
}

fn build_temp_html_path() -> PathBuf {
    env::temp_dir().join(format!("carbon-pdf-export-{}.html", Uuid::new_v4()))
}

fn format_write_error(error: std::io::Error, target_path: &Path, stage: &str) -> String {
    if error.kind() == ErrorKind::PermissionDenied {
        return format!(
            "Failed to {stage} PDF at {}. macOS may be blocking Carbon from accessing your Downloads folder. Check System Settings > Privacy & Security > Files and Folders.",
            target_path.display()
        );
    }

    format!(
        "Failed to {stage} PDF at {}: {error}",
        target_path.display()
    )
}

#[cfg(test)]
mod tests {
    use super::{find_available_pdf_output_path, sanitize_pdf_file_name};
    use std::{fs, path::PathBuf};
    use uuid::Uuid;

    #[test]
    fn sanitize_pdf_file_name_replaces_invalid_characters() {
        assert_eq!(sanitize_pdf_file_name(r#" a:/b\c*?"<>| "#), "a__b_c______");
        assert_eq!(sanitize_pdf_file_name("..."), "Untitled");
    }

    #[test]
    fn find_available_pdf_output_path_appends_parenthesized_suffixes() {
        let temp_dir =
            std::env::temp_dir().join(format!("carbon-pdf-export-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).expect("failed to create temp dir");

        let cleanup = TempDirCleanup(temp_dir.clone());

        fs::write(temp_dir.join("idea.pdf"), b"1").expect("failed to seed idea.pdf");
        fs::write(temp_dir.join("idea(1).pdf"), b"1").expect("failed to seed idea(1).pdf");

        let available = find_available_pdf_output_path(&temp_dir, "idea");
        assert_eq!(available, temp_dir.join("idea(2).pdf"));

        drop(cleanup);
    }

    struct TempDirCleanup(PathBuf);

    impl Drop for TempDirCleanup {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}

#[cfg(target_os = "macos")]
type PdfExportResultSender = Arc<Mutex<Option<oneshot::Sender<Result<(), String>>>>>;

#[cfg(target_os = "macos")]
struct NativePdfExportSession {
    window: Retained<NSWindow>,
    user_content_controller: Retained<WKUserContentController>,
    webview: Retained<WKWebView>,
    delegate: Retained<PdfExportNavigationDelegate>,
    print_operation: Option<Retained<NSPrintOperation>>,
    html_path: PathBuf,
    output_path: PathBuf,
}

#[cfg(target_os = "macos")]
thread_local! {
    static PDF_EXPORT_SESSIONS: RefCell<HashMap<String, NativePdfExportSession>> = RefCell::new(HashMap::new());
}

#[cfg(target_os = "macos")]
struct PdfExportNavigationDelegateIvars {
    app_handle: AppHandle,
    export_id: String,
    result_sender: PdfExportResultSender,
    started: Cell<bool>,
}

#[cfg(target_os = "macos")]
define_class!(
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = PdfExportNavigationDelegateIvars]
    struct PdfExportNavigationDelegate;

    unsafe impl NSObjectProtocol for PdfExportNavigationDelegate {}

    unsafe impl WKNavigationDelegate for PdfExportNavigationDelegate {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide_policy_for_navigation_action(
            &self,
            web_view: &WKWebView,
            navigation_action: &WKNavigationAction,
            decision_handler: &DynBlock<dyn Fn(WKNavigationActionPolicy)>,
        ) {
            handle_navigation_action(self, web_view, navigation_action, decision_handler);
        }

        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn did_fail_provisional_navigation(
            &self,
            _web_view: &WKWebView,
            _navigation: Option<&WKNavigation>,
            error: &NSError,
        ) {
            self.finish_with_error(error.localizedDescription().to_string());
        }

        #[unsafe(method(webView:didFailNavigation:withError:))]
        fn did_fail_navigation(
            &self,
            _web_view: &WKWebView,
            _navigation: Option<&WKNavigation>,
            error: &NSError,
        ) {
            self.finish_with_error(error.localizedDescription().to_string());
        }

        #[unsafe(method(webView:didFinishNavigation:))]
        fn did_finish_navigation(
            &self,
            web_view: &WKWebView,
            _navigation: &WKNavigation,
        ) {
            if self.ivars().started.replace(true) {
                return;
            }
            eprintln!("[pdf-export] didFinishNavigation");
            await_pdf_ready_signal(
                web_view,
                self.ivars().export_id.clone(),
                self.ivars().result_sender.clone(),
            );
        }
    }

    unsafe impl WKScriptMessageHandler for PdfExportNavigationDelegate {
        #[unsafe(method(userContentController:didReceiveScriptMessage:))]
        unsafe fn user_content_controller_did_receive_script_message(
            &self,
            _user_content_controller: &WKUserContentController,
            message: &WKScriptMessage,
        ) {
            let name = message.name().to_string();
            if name == PDF_EXPORT_READY_HANDLER_NAME {
                if message.webView().is_some() {
                    start_pdf_render(
                        self.ivars().app_handle.clone(),
                        self.ivars().export_id.clone(),
                        self.ivars().result_sender.clone(),
                    );
                    return;
                }
                self.finish_with_error("PDF renderer lost its WKWebView instance".to_string());
                return;
            }

            let error_message = if name == PDF_EXPORT_ERROR_HANDLER_NAME {
                let body = message.body();
                if let Ok(body) = body.downcast::<NSString>() {
                    body.to_string()
                } else {
                    "PDF preparation failed in the WKWebView document".to_string()
                }
            } else {
                format!("Unexpected PDF renderer message: {name}")
            };

            self.finish_with_error(error_message);
        }
    }
);

#[cfg(target_os = "macos")]
impl PdfExportNavigationDelegate {
    fn new(
        app_handle: AppHandle,
        export_id: String,
        result_sender: PdfExportResultSender,
        mtm: MainThreadMarker,
    ) -> Retained<Self> {
        let delegate = Self::alloc(mtm).set_ivars(PdfExportNavigationDelegateIvars {
            app_handle,
            export_id,
            result_sender,
            started: Cell::new(false),
        });

        unsafe { msg_send![super(delegate), init] }
    }

    fn finish_with_error(&self, message: String) {
        finish_native_pdf_export(
            &self.ivars().export_id,
            &self.ivars().result_sender,
            Err(message),
        );
    }
}

#[cfg(target_os = "macos")]
fn finish_native_pdf_export(
    export_id: &str,
    result_sender: &PdfExportResultSender,
    result: Result<(), String>,
) {
    let session = PDF_EXPORT_SESSIONS.with(|sessions| sessions.borrow_mut().remove(export_id));

    if let Some(session) = session {
        unsafe {
            session.webview.stopLoading();
            session.webview.setNavigationDelegate(None);
            session
                .user_content_controller
                .removeScriptMessageHandlerForName(&NSString::from_str(PDF_EXPORT_READY_HANDLER_NAME));
            session
                .user_content_controller
                .removeScriptMessageHandlerForName(&NSString::from_str(PDF_EXPORT_ERROR_HANDLER_NAME));
            session.window.orderOut(None);
        }
        let _ = fs::remove_file(&session.html_path);
        drop(session.user_content_controller);
        drop(session.print_operation);
        drop(session.window);
        drop(session.delegate);
        drop(session.webview);
    }

    if let Ok(mut slot) = result_sender.lock() {
        if let Some(sender) = slot.take() {
            let _ = sender.send(result);
        }
    }
}

#[cfg(target_os = "macos")]
fn cleanup_native_pdf_export(export_id: &str) {
    let session = PDF_EXPORT_SESSIONS.with(|sessions| sessions.borrow_mut().remove(export_id));
    if let Some(session) = session {
        unsafe {
            session.webview.stopLoading();
            session.webview.setNavigationDelegate(None);
            session
                .user_content_controller
                .removeScriptMessageHandlerForName(&NSString::from_str(PDF_EXPORT_READY_HANDLER_NAME));
            session
                .user_content_controller
                .removeScriptMessageHandlerForName(&NSString::from_str(PDF_EXPORT_ERROR_HANDLER_NAME));
            session.window.orderOut(None);
        }
        let _ = fs::remove_file(&session.html_path);
        drop(session.print_operation);
    }
}

#[cfg(target_os = "macos")]
fn await_pdf_ready_signal(
    web_view: &WKWebView,
    export_id: String,
    result_sender: PdfExportResultSender,
) {
    let script = NSString::from_str(
        "(function () { \
            window.__carbonPdfAwaitReady() \
              .then(function () { window.webkit.messageHandlers.carbonPdfReady.postMessage('ready'); }) \
              .catch(function (error) { \
                var message = error && error.message ? error.message : String(error); \
                window.webkit.messageHandlers.carbonPdfError.postMessage(message); \
              }); \
          })();",
    );

    let completion = RcBlock::new(move |_value: *mut objc2::runtime::AnyObject, error: *mut NSError| {
        if !error.is_null() {
            finish_native_pdf_export(
                &export_id,
                &result_sender,
                Err(unsafe { (&*error).localizedDescription().to_string() }),
            );
        }
    });

    unsafe {
        web_view.evaluateJavaScript_completionHandler(&script, Some(&completion));
    }
}

#[cfg(target_os = "macos")]
fn start_pdf_render(app_handle: AppHandle, export_id: String, result_sender: PdfExportResultSender) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(10));
        let app_handle_for_main = app_handle.clone();
        let export_id_for_main = export_id.clone();
        let result_sender_for_main = result_sender.clone();
        let _ = app_handle.run_on_main_thread(move || {
            start_pdf_render_on_main_thread(
                app_handle_for_main,
                export_id_for_main,
                result_sender_for_main,
            );
        });
    });
}

#[cfg(target_os = "macos")]
fn start_pdf_render_on_main_thread(
    app_handle: AppHandle,
    export_id: String,
    result_sender: PdfExportResultSender,
) {
    let session_state = PDF_EXPORT_SESSIONS.with(|sessions| {
        sessions
            .borrow()
            .get(&export_id)
            .map(|session| {
                (
                    session.window.clone(),
                    session.webview.clone(),
                    session.output_path.clone(),
                )
            })
    });

    let Some((window, web_view, output_path)) = session_state else {
        finish_native_pdf_export(
            &export_id,
            &result_sender,
            Err("PDF export session lost its WebView or output path".to_string()),
        );
        return;
    };

    let operation = match start_print_operation_to_pdf(&window, &web_view, &output_path) {
        Ok(operation) => operation,
        Err(error) => {
            finish_native_pdf_export(&export_id, &result_sender, Err(error));
            return;
        }
    };

    PDF_EXPORT_SESSIONS.with(|sessions| {
        if let Some(session) = sessions.borrow_mut().get_mut(&export_id) {
            session.print_operation = Some(operation);
        }
    });

    monitor_pdf_output_file(app_handle, export_id, output_path, result_sender);
}

#[cfg(target_os = "macos")]
fn build_pdf_print_info(output_path: &Path) -> Result<Retained<NSPrintInfo>, String> {
    if MainThreadMarker::new().is_none() {
        return Err("PDF export print info must be created on the macOS main thread".to_string());
    }

    let shared_print_info = NSPrintInfo::sharedPrintInfo();
    let shared_attributes = unsafe { shared_print_info.dictionary() };
    let print_info = unsafe { NSPrintInfo::initWithDictionary(NSPrintInfo::alloc(), &shared_attributes) };

    print_info.setPaperSize(CGSize::new(PDF_EXPORT_PAGE_WIDTH, PDF_EXPORT_PAGE_HEIGHT));
    print_info.setOrientation(NSPaperOrientation::Portrait);
    print_info.setHorizontallyCentered(false);
    print_info.setVerticallyCentered(false);
    print_info.setHorizontalPagination(NSPrintingPaginationMode::Automatic);
    print_info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
    print_info.setLeftMargin(14.0 * 72.0 / 25.4);
    print_info.setRightMargin(14.0 * 72.0 / 25.4);
    print_info.setTopMargin(16.0 * 72.0 / 25.4);
    print_info.setBottomMargin(18.0 * 72.0 / 25.4);
    unsafe {
        print_info.setJobDisposition(NSPrintSaveJob);
    }
    let dictionary = unsafe { print_info.dictionary() };
    let output_url = NSURL::fileURLWithPath(&NSString::from_str(&output_path.to_string_lossy()));
    unsafe {
        dictionary.insert(NSPrintJobSavingURL, output_url.as_ref());
    }

    Ok(print_info)
}

#[cfg(target_os = "macos")]
fn start_print_operation_to_pdf(
    window: &NSWindow,
    web_view: &WKWebView,
    output_path: &Path,
) -> Result<Retained<NSPrintOperation>, String> {
    let print_info = build_pdf_print_info(output_path)?;
    let operation = unsafe { web_view.printOperationWithPrintInfo(&print_info) };
    operation.setShowsPrintPanel(false);
    operation.setShowsProgressPanel(false);
    operation.setCanSpawnSeparateThread(true);

    eprintln!("[pdf-export] run print modal operation");
    unsafe {
        operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            window,
            None,
            None,
            std::ptr::null_mut(),
        );
    }

    Ok(operation)
}

#[cfg(target_os = "macos")]
fn monitor_pdf_output_file(
    app_handle: AppHandle,
    export_id: String,
    output_path: PathBuf,
    result_sender: PdfExportResultSender,
) {
    std::thread::spawn(move || {
        let mut last_non_zero_size = None;
        let mut stable_count = 0;

        for _ in 0..300 {
            if let Ok(metadata) = fs::metadata(&output_path) {
                let size = metadata.len();
                if size > 0 {
                    if Some(size) == last_non_zero_size {
                        stable_count += 1;
                    } else {
                        last_non_zero_size = Some(size);
                        stable_count = 0;
                    }

                    if stable_count >= 2 {
                        let export_id_for_main = export_id.clone();
                        let result_sender_for_main = result_sender.clone();
                        let _ = app_handle.run_on_main_thread(move || {
                            finish_native_pdf_export(
                                &export_id_for_main,
                                &result_sender_for_main,
                                Ok(()),
                            );
                        });
                        return;
                    }
                }
            }

            std::thread::sleep(Duration::from_millis(100));
        }
    });
}

fn handle_navigation_action(
    delegate: &PdfExportNavigationDelegate,
    web_view: &WKWebView,
    navigation_action: &WKNavigationAction,
    decision_handler: &DynBlock<dyn Fn(WKNavigationActionPolicy)>,
) {
    let _ = (delegate, web_view, navigation_action);
    (*decision_handler).call((WKNavigationActionPolicy::Allow,));
}

#[cfg(target_os = "macos")]
fn create_pdf_host_window(
    mtm: MainThreadMarker,
    web_view: &WKWebView,
) -> Retained<NSWindow> {
    let window = unsafe {
        NSWindow::initWithContentRect_styleMask_backing_defer(
            NSWindow::alloc(mtm),
            CGRect::new(
                CGPoint::new(
                    PDF_EXPORT_HOST_WINDOW_ORIGIN_X,
                    PDF_EXPORT_HOST_WINDOW_ORIGIN_Y,
                ),
                CGSize::new(PDF_EXPORT_PAGE_WIDTH, PDF_EXPORT_PAGE_HEIGHT),
            ),
            NSWindowStyleMask::Titled,
            NSBackingStoreType::Buffered,
            false,
        )
    };

    unsafe {
        window.setReleasedWhenClosed(false);
    }

    window.setExcludedFromWindowsMenu(true);
    window.setHasShadow(false);
    window.setOpaque(false);
    window.setAlphaValue(0.0);
    window.setIgnoresMouseEvents(true);
    window.setAnimationBehavior(NSWindowAnimationBehavior::None);
    window.setContentView(Some(web_view));
    window.makeKeyAndOrderFront(None);

    window
}

#[cfg(target_os = "macos")]
fn start_native_pdf_export(
    app_handle: AppHandle,
    export_id: String,
    request: NotePdfExportRequest,
    html_path: PathBuf,
    sender: oneshot::Sender<Result<(), String>>,
) {
    let Some(mtm) = MainThreadMarker::new() else {
        let _ = fs::remove_file(&html_path);
        let _ = sender.send(Err(
            "PDF export must run on the macOS main thread".to_string()
        ));
        return;
    };

    let configuration = unsafe { WKWebViewConfiguration::new(mtm) };
    let user_content_controller = unsafe { configuration.userContentController() };
    let web_view = unsafe {
        WKWebView::initWithFrame_configuration(
            WKWebView::alloc(mtm),
            CGRect::new(
                CGPoint::ZERO,
                CGSize::new(PDF_EXPORT_PAGE_WIDTH, PDF_EXPORT_PAGE_HEIGHT),
            ),
            &configuration,
        )
    };
    let window = create_pdf_host_window(mtm, &web_view);

    let result_sender = Arc::new(Mutex::new(Some(sender)));
    let delegate = PdfExportNavigationDelegate::new(
        app_handle,
        export_id.clone(),
        result_sender.clone(),
        mtm,
    );

    unsafe {
        web_view.setMediaType(Some(&NSString::from_str("print")));
        user_content_controller.addScriptMessageHandler_name(
            ProtocolObject::from_ref(&*delegate),
            &NSString::from_str(PDF_EXPORT_READY_HANDLER_NAME),
        );
        user_content_controller.addScriptMessageHandler_name(
            ProtocolObject::from_ref(&*delegate),
            &NSString::from_str(PDF_EXPORT_ERROR_HANDLER_NAME),
        );
        web_view.setNavigationDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    }

    PDF_EXPORT_SESSIONS.with(|sessions| {
        sessions.borrow_mut().insert(
            export_id.clone(),
            NativePdfExportSession {
                window: window.clone(),
                user_content_controller: user_content_controller.clone(),
                webview: web_view.clone(),
                delegate: delegate.clone(),
                print_operation: None,
                html_path: html_path.clone(),
                output_path: PathBuf::from(&request.output_path),
            },
        );
    });

    eprintln!(
        "[pdf-export] loading html={} vault={}",
        html_path.display(),
        request.vault_path
    );
    let html_url = NSURL::fileURLWithPath(&NSString::from_str(&html_path.to_string_lossy()));
    let read_access_url = NSURL::fileURLWithPath_isDirectory(&NSString::from_str("/"), true);

    let navigation =
        unsafe { web_view.loadFileURL_allowingReadAccessToURL(&html_url, &read_access_url) };

    if navigation.is_none() {
        finish_native_pdf_export(
            &export_id,
            &result_sender,
            Err("Failed to load the PDF document into WKWebView".to_string()),
        );
    }
}

#[cfg(target_os = "macos")]
async fn render_pdf_to_path(
    app: AppHandle,
    request: NotePdfExportRequest,
) -> Result<(), String> {
    let export_id = Uuid::new_v4().to_string();
    let export_id_for_render = export_id.clone();
    let (sender, receiver) = oneshot::channel::<Result<(), String>>();
    let html_path = build_temp_html_path();
    let html_path_for_cleanup = html_path.clone();

    fs::write(&html_path, &request.html_document)
        .map_err(|error| format!("Failed to prepare the PDF document HTML: {error}"))?;

    let app_for_main_thread = app.clone();
    app.run_on_main_thread(move || {
        start_native_pdf_export(app_for_main_thread, export_id_for_render, request, html_path, sender);
    })
    .map_err(|error| {
        let _ = fs::remove_file(&html_path_for_cleanup);
        format!("Failed to start the macOS PDF renderer: {error}")
    })?;

    let result = tokio::time::timeout(PDF_EXPORT_TIMEOUT, receiver)
        .await
        .map_err(|_| {
            cleanup_native_pdf_export(&export_id);
            "Timed out while preparing the PDF renderer".to_string()
        })?;

    result.map_err(|_| "PDF export renderer stopped unexpectedly".to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn render_pdf_to_path(
    _app: AppHandle,
    _request: NotePdfExportRequest,
) -> Result<(), String> {
    // TODO: Windows should use WebView2 PrintToPdfAsync.
    // TODO: Linux should use a WebKitGTK/GTK export path.
    Err("PDF export is currently implemented only on macOS.".to_string())
}

#[tauri::command]
pub async fn start_note_pdf_export(
    app: AppHandle,
    request: NotePdfExportRequest,
) -> Result<String, String> {
    let output_path = build_pdf_output_path(&app, &request)?;
    let temp_output_path = build_temp_pdf_path(&output_path)?;
    let output_path_string = output_path.to_string_lossy().into_owned();

    let native_request = NotePdfExportRequest {
        output_path: temp_output_path.to_string_lossy().into_owned(),
        ..request
    };

    render_pdf_to_path(app.clone(), native_request).await?;
    fs::rename(&temp_output_path, &output_path).map_err(|error| {
        let _ = fs::remove_file(&temp_output_path);
        format_write_error(error, &output_path, "finalize")
    })?;

    Ok(output_path_string)
}
