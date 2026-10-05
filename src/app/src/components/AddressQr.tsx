import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// The whole address in one run (it must copy without spaces), with the first
// and last four characters emphasized: those are what people actually compare,
// and what address-poisoning fakes. A prefix every address shares, such as
// "0x", is not part of the key.
export function FullAddress({ address, prefix }: { address: string; prefix?: string }) {
  const lead = prefix ?? (address.startsWith('0x') ? '0x' : '')
  const body = address.slice(lead.length)
  return (
    <p className="w-full break-all text-center font-mono text-[12px] leading-relaxed text-muted-foreground">
      {lead}
      <span className="font-semibold text-foreground">{body.slice(0, 4)}</span>
      {body.slice(4, -4)}
      <span className="inline-block font-semibold text-foreground">{body.slice(-4)}</span>
    </p>
  )
}

// An address as a QR code on a white card, with the network's logo in the middle.
export function AddressQr({ address, icon }: { address: string; icon?: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    setDataUrl(null)
    QRCode.toDataURL(address, {
      width: 220,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
      // Q recovers about a quarter of the code, far more than the logo in the
      // middle covers, so the QR still scans with it.
      errorCorrectionLevel: 'Q',
    })
      .then((url) => {
        if (current) setDataUrl(url)
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [address])

  return (
    <div className="relative rounded-2xl bg-white p-3 shadow-sm">
      {dataUrl ? (
        <img src={dataUrl} alt="Address QR code" width={188} height={188} className="block" />
      ) : (
        <div className="h-[188px] w-[188px] animate-pulse rounded-lg bg-neutral-200" />
      )}
      {dataUrl && icon && (
        <span className="pop-enter absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white p-1 shadow-sm">
          <img src={icon} alt="" className="h-full w-full rounded-full object-cover" />
        </span>
      )}
    </div>
  )
}
