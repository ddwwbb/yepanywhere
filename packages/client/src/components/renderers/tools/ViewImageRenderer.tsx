import { useState } from "react";
import { useFetchedImage } from "../../../hooks/useRemoteImage";
import { Modal } from "../../ui/Modal";
import type { ToolRenderer } from "./types";

interface ViewImageInput {
  path: string;
}

function getFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * ViewImage tool use - shows the image path
 */
function ViewImageToolUse({ input }: { input: ViewImageInput }) {
  return (
    <div className="viewimage-tool-use">
      <span className="viewimage-path">{input.path}</span>
    </div>
  );
}

/**
 * Image content displayed inside the modal
 */
function ViewImageModalContent({ url, alt }: { url: string; alt: string }) {
  return (
    <div className="read-image-result">
      <img
        className="read-image"
        src={url}
        alt={alt}
        style={{ maxWidth: "100%" }}
      />
    </div>
  );
}

/**
 * ViewImage tool result - clickable filename that opens modal with the image.
 * Fetches via XHR (with auth) and displays as blob URL.
 */
function ViewImageToolResult({
  input,
  isError,
}: {
  input: ViewImageInput;
  isError: boolean;
}) {
  const [showModal, setShowModal] = useState(false);
  const apiPath = input?.path
    ? `/api/local-image?path=${encodeURIComponent(input.path)}`
    : null;
  const { url, loading, error } = useFetchedImage(apiPath);
  const fileName = getFileName(input.path);

  if (isError || error) {
    return (
      <div className="viewimage-error">{error ?? "Failed to load image"}</div>
    );
  }

  if (loading || !url) {
    return <div className="viewimage-loading">Loading image...</div>;
  }

  return (
    <>
      <div className="read-image-result">
        <button
          type="button"
          className="file-link-button"
          onClick={() => setShowModal(true)}
        >
          {fileName}
          <span className="file-line-count">(image)</span>
        </button>
      </div>
      {showModal && (
        <Modal title={fileName} onClose={() => setShowModal(false)}>
          <ViewImageModalContent url={url} alt={fileName} />
        </Modal>
      )}
    </>
  );
}

/**
 * Interactive summary - clickable filename that opens modal
 */
function ViewImageInteractiveSummary({
  input,
}: {
  input: ViewImageInput;
}) {
  const [showModal, setShowModal] = useState(false);
  const apiPath = input?.path
    ? `/api/local-image?path=${encodeURIComponent(input.path)}`
    : null;
  const { url, error } = useFetchedImage(apiPath);
  const fileName = getFileName(input.path);

  if (error || !url) {
    return <span>{fileName}</span>;
  }

  return (
    <>
      <button
        type="button"
        className="file-link-inline"
        onClick={(e) => {
          e.stopPropagation();
          setShowModal(true);
        }}
      >
        {fileName}
        <span className="file-line-count-inline">(image)</span>
      </button>
      {showModal && (
        <Modal title={fileName} onClose={() => setShowModal(false)}>
          <ViewImageModalContent url={url} alt={fileName} />
        </Modal>
      )}
    </>
  );
}

export const viewImageRenderer: ToolRenderer<ViewImageInput, unknown> = {
  tool: "ViewImage",
  displayName: "View Image",

  renderToolUse(input, _context) {
    return <ViewImageToolUse input={input as ViewImageInput} />;
  },

  renderToolResult(result, isError, _context, input) {
    return (
      <ViewImageToolResult input={input as ViewImageInput} isError={isError} />
    );
  },

  getUseSummary(input) {
    const path = (input as ViewImageInput)?.path ?? "";
    return getFileName(path);
  },

  getResultSummary(_result, isError) {
    return isError ? "Error" : "Image loaded";
  },

  renderInteractiveSummary(input, _result, _isError, _context) {
    return <ViewImageInteractiveSummary input={input as ViewImageInput} />;
  },
};
