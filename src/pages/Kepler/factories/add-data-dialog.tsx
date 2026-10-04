import { useContext, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { ModalDialogFactory } from "@kepler.gl/components";
import { AddDataDockContext } from "../components/maono-map-shell/AddDataDockContext";

// Kepler dependency injection exports a factory rather than a React component.
// eslint-disable-next-line react-refresh/only-export-components
function DockedDataDialogFactory() {
  const DefaultDialog = ModalDialogFactory();
  function DockedDataDialog(props: ComponentProps<typeof DefaultDialog>) {
    const dock = useContext(AddDataDockContext);
    if (dock && props.title === "modal.title.addDataToMap") {
      // Never mount a modal/backdrop, including the render before the outlet
      // ref resolves or while initial project hydration blocks interaction.
      return props.isOpen && dock.enabled && dock.target
        ? createPortal(props.children, dock.target)
        : null;
    }
    return <DefaultDialog {...props} />;
  }
  return DockedDataDialog;
}

export function replaceAddDataDialog() {
  return [ModalDialogFactory, DockedDataDialogFactory];
}
