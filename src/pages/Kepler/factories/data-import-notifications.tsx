import { useContext, useEffect, useMemo, useState, type ComponentProps } from "react";
import { useSelector } from "react-redux";
import { NotificationPanelFactory } from "@kepler.gl/components";
import { AddDataDockContext } from "../components/maono-map-shell/AddDataDockContext";
import { dataImportErrorMessage, importErrorText, isNativeImportError } from "../components/load-data-modal/data-import-messages";

const EMPTY_PROGRESS: Record<string, { error?: unknown }> = {};
type ProgressState = { demo?: { keplerGl?: { map?: { visState?: { fileLoadingProgress?: Record<string, { error?: unknown }> } } } } };

// Kepler dependency injection exports a factory rather than a React component.
// eslint-disable-next-line react-refresh/only-export-components
function PortugueseImportNotificationsFactory(...deps: Parameters<typeof NotificationPanelFactory>) {
  const NativePanel = NotificationPanelFactory(...deps);
  function PortugueseImportNotifications(props: ComponentProps<typeof NativePanel>) {
    const dock = useContext(AddDataDockContext);
    const progress = useSelector((state: ProgressState) => state.demo?.keplerGl?.map?.visState?.fileLoadingProgress ?? EMPTY_PROGRESS);
    const [remembered, setRemembered] = useState<Record<string, string>>({});
    const translated = useMemo(() => {
      if (!dock) return {};
      const errors = new Set(Object.values(progress).map((item) => importErrorText(item.error)).filter(Boolean));
      return Object.fromEntries(props.notifications
        .filter((notification) => typeof notification.message === "string" &&
          (errors.has(notification.message) || isNativeImportError(notification.message)))
        .map((notification) => [notification.id, dataImportErrorMessage(notification.message)]));
    }, [dock, progress, props.notifications]);

    useEffect(() => {
      // File progress is cleared at completion. Retain only translations of
      // still-visible import notifications, so their text does not switch back.
      setRemembered((previous) => {
        const next = Object.fromEntries(props.notifications.flatMap((notification) => {
          const message = translated[notification.id] ?? previous[notification.id];
          return message ? [[notification.id, message]] : [];
        }));
        return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
      });
    }, [props.notifications, translated]);

    return <NativePanel {...props} notifications={props.notifications.map((notification) => {
      const message = dock && (translated[notification.id] ?? remembered[notification.id]);
      return message ? { ...notification, message } : notification;
    })} />;
  }
  return PortugueseImportNotifications;
}
PortugueseImportNotificationsFactory.deps = NotificationPanelFactory.deps;
export function replaceDataImportNotifications() {
  return [NotificationPanelFactory, PortugueseImportNotificationsFactory];
}
