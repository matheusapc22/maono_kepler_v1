import React, { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import { useIntl } from 'react-intl';
import type Markdown from 'markdown-to-jsx';
import { FileUploadFactory } from '@kepler.gl/components';
import LinkRenderer from '@kepler.gl/components/dist/common/link-renderer';

// This adapter affects only the native uploader's file-format guidance.
// Keep every upload handler, state transition and unrelated link native.
function FileFormatGuidanceLink(props: React.ComponentProps<typeof LinkRenderer>) {
  let isKeplerGuide = false;
  try {
    isKeplerGuide = new URL(props.href ?? '').hostname === 'docs.kepler.gl';
  } catch { /* Relative/provider links keep their native renderer. */ }
  return isKeplerGuide ? <span>{props.children}</span> : <LinkRenderer {...props} />;
}

type GuidanceElement = { className?: string; children?: ReactNode; options?: React.ComponentProps<typeof Markdown>['options'] };

function adaptFormatGuidance(node: ReactNode, inGuidance = false): ReactNode {
  if (!isValidElement(node) && !Array.isArray(node)) return node;
  return Children.map(node, child => {
    if (!isValidElement<GuidanceElement>(child)) return child;
    const isGuidance = inGuidance || child.props.className === 'file-upload__message';
    if (isGuidance && typeof child.props.children === 'string' && child.props.options?.overrides?.a) {
      return cloneElement(child, {
        options: {
          ...child.props.options,
          overrides: { ...child.props.options?.overrides, a: { component: FileFormatGuidanceLink } },
        },
      });
    }
    return child.props.children === undefined ? child : cloneElement(child, {
      children: adaptFormatGuidance(child.props.children, isGuidance),
    });
  });
}

export function CustomFileUploadFactory() {
  const DefaultFileUpload = FileUploadFactory();
  type Props = React.ComponentProps<typeof DefaultFileUpload.WrappedComponent>;
  // Kepler 3.2.0 exposes its class through injectIntl. The version/class seam
  // is guarded by map-help-navigation.test.mjs before dependency upgrades.
  const NativeFileUpload = DefaultFileUpload.WrappedComponent as React.ComponentClass<Props>;
  class FileUploadWithLocalGuidance extends NativeFileUpload {
    render() {
      return adaptFormatGuidance(super.render());
    }
  }
  return function FileUpload(props: React.ComponentProps<typeof DefaultFileUpload>) {
    const intl = useIntl();
    return <FileUploadWithLocalGuidance {...props} intl={intl} />;
  };
}

// Kepler dependency injection exports factories rather than React components.
// eslint-disable-next-line react-refresh/only-export-components
export function replaceFileUpload() {
  return [FileUploadFactory, CustomFileUploadFactory];
}
