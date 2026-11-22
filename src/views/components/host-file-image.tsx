import { useEffect, useState } from "react";
import { useFiles } from "skybridge/web";

type HostFileImageProps = {
  fileId?: string;
  downloadUrl?: string;
  alt: string;
  className?: string;
};

/** Shows a host file; refreshes download_url via getDownloadUrl when needed. */
export function HostFileImage({
  fileId,
  downloadUrl,
  alt,
  className,
}: HostFileImageProps) {
  const { getDownloadUrl } = useFiles();
  const [src, setSrc] = useState(downloadUrl?.trim() || "");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const initial = downloadUrl?.trim() || "";
    setSrc(initial);
    setFailed(false);

    if (initial || !fileId?.trim()) return;

    void getDownloadUrl({ fileId: fileId.trim() })
      .then((result) => {
        if (!cancelled && result.downloadUrl) setSrc(result.downloadUrl);
      })
      .catch(() => {
        /* host without file API — leave empty */
      });

    return () => {
      cancelled = true;
    };
  }, [downloadUrl, fileId, getDownloadUrl]);

  if (!src || failed) {
    return (
      <div
        className={`flex max-h-48 min-h-28 w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 text-sm text-muted-foreground ${className ?? ""}`}
      >
        {alt}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => {
        if (!fileId?.trim()) {
          setFailed(true);
          return;
        }
        void getDownloadUrl({ fileId: fileId.trim() })
          .then((result) => {
            if (result.downloadUrl && result.downloadUrl !== src) {
              setSrc(result.downloadUrl);
            } else {
              setFailed(true);
            }
          })
          .catch(() => setFailed(true));
      }}
    />
  );
}
