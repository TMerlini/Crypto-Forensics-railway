import { Divider, Grid, H1, H2, Stack, Stat, Table, Text } from "cursor/canvas";

/**
 * Cursor picks up `.canvas.tsx` files from the IDE-managed folder:
 *   .cursor/projects/<workspace>/canvases/
 * Copy this file there (or use Trace → Reports → Download Cursor Canvas).
 *
 * Replace REPORT_DATA with your trace bundle, or download a pre-filled file from the app.
 */
const REPORT_DATA = {
  target: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  chainId: 1,
  direction: "both",
  runId: "00000000-0000-0000-0000-000000000001",
  savedAt: "2026-05-04T12:00:00.000Z",
  analysis: {
    totals: {
      inflowCount: 12,
      outflowCount: 8,
      uniqueVictimAddresses: 3,
      nodesDiscovered: 84,
      uniqueSendersToTarget: 10,
      uniqueRecipientsFromTarget: 6,
      firstInflowAt: "2026-01-15T08:22:11.000Z",
      lastOutflowAt: "2026-03-02T14:01:00.000Z",
    },
    inflowsByAsset: [
      { symbol: "ETH", amountFormatted: "1.42", count: 5 },
      { symbol: "USDT", amountFormatted: "450.00", count: 4 },
    ],
    outflowsByAsset: [{ symbol: "ETH", amountFormatted: "1.38", count: 3 }],
    gasSeedChain: [{ hop: 0 }],
    cashOutChain: [{ hop: 0 }, { hop: 1 }],
    cashOutEndpoints: [{ label: "Example CEX" }],
  },
};

export default function TraceSearchReport() {
  const a = REPORT_DATA.analysis;
  const t = a.totals;
  const target = REPORT_DATA.target || "";
  const short =
    target.length > 14 ? target.slice(0, 10) + "…" + target.slice(-6) : target;
  return (
    <Stack gap={20}>
      <H1>Trace search report</H1>
      <Text tone="secondary" size="small">
        {short}
        {" · chain "}
        {String(REPORT_DATA.chainId ?? "")}
        {" · "}
        {String(REPORT_DATA.direction ?? "")}
        {REPORT_DATA.runId
          ? " · run " + String(REPORT_DATA.runId).slice(0, 8) + "…"
          : ""}
      </Text>
      <Grid columns={4} gap={12}>
        <Stat value={String(t.inflowCount)} label="Inflows" />
        <Stat value={String(t.outflowCount)} label="Outflows" />
        <Stat value={String(t.uniqueVictimAddresses)} label="Likely victims" />
        <Stat value={String(t.nodesDiscovered)} label="Nodes" />
      </Grid>
      <Divider />
      <H2>Timeline</H2>
      <Text tone="secondary" size="small">
        First inflow:{" "}
        {t.firstInflowAt ? String(t.firstInflowAt).replace("T", " ").slice(0, 19) : "—"}
        {" · Last outflow: "}
        {t.lastOutflowAt ? String(t.lastOutflowAt).replace("T", " ").slice(0, 19) : "—"}
      </Text>
      <Divider />
      <H2>Received by asset</H2>
      <Table
        headers={["Symbol", "Amount", "Transfers"]}
        rows={(a.inflowsByAsset ?? []).slice(0, 24).map((x) => [
          String(x.symbol ?? ""),
          String(x.amountFormatted ?? ""),
          String(x.count ?? ""),
        ])}
      />
      <Divider />
      <H2>Sent by asset</H2>
      <Table
        headers={["Symbol", "Amount", "Transfers"]}
        rows={(a.outflowsByAsset ?? []).slice(0, 24).map((x) => [
          String(x.symbol ?? ""),
          String(x.amountFormatted ?? ""),
          String(x.count ?? ""),
        ])}
      />
      <Divider />
      <H2>Chains</H2>
      <Text tone="secondary" size="small">
        Gas-seed hops: {String((a.gasSeedChain ?? []).length)} · Cash-out hops:{" "}
        {String((a.cashOutChain ?? []).length)} · Endpoints labelled:{" "}
        {String((a.cashOutEndpoints ?? []).length)}
      </Text>
      <Text tone="secondary" size="small">
        Exported{" "}
        {String(REPORT_DATA.savedAt ?? "")
          .replace("T", " ")
          .slice(0, 19)}
      </Text>
    </Stack>
  );
}
