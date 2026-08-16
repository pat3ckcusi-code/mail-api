/** imapflow envelope address entries -> the app's {name, address} shape. */
function addressFromEnvelopeEntry(entry) {
  if (!entry) return { name: null, address: '' };
  const address = entry.address || (entry.mailbox && entry.host ? `${entry.mailbox}@${entry.host}` : '');
  return { name: entry.name || null, address };
}

function addressListFromEnvelope(list) {
  return (list || []).map(addressFromEnvelopeEntry).filter((a) => a.address);
}

/** Row shape for GET /emails, /emails/search - built from envelope+flags, no body fetch needed. */
export function summaryFromMessage(message) {
  const from = addressListFromEnvelope(message.envelope?.from)[0] || { name: null, address: '' };
  return {
    uid: message.uid,
    from,
    subject: message.envelope?.subject || '',
    date: (message.envelope?.date || new Date()).toISOString(),
    unread: !message.flags?.has('\\Seen'),
  };
}

/**
 * Full message shape for GET /emails/:uid, built from a mailparser pass over
 * the raw source. `attachments[].index` is that attachment's position in
 * *this* array - stable within this one parse, not a durable id (see
 * MailAttachment.index's doc comment in the Flutter app's models/attachment.dart).
 */
export function detailFromParsed(parsed) {
  const to = Array.isArray(parsed.to) ? parsed.to : parsed.to ? [parsed.to] : [];
  const cc = Array.isArray(parsed.cc) ? parsed.cc : parsed.cc ? [parsed.cc] : [];
  return {
    subject: parsed.subject || '',
    from: addressListFromEnvelope(parsed.from?.value)[0] || { name: null, address: '' },
    to: to.flatMap((group) => addressListFromEnvelope(group.value)),
    cc: cc.flatMap((group) => addressListFromEnvelope(group.value)),
    date: (parsed.date || new Date()).toISOString(),
    text: parsed.text || '',
    attachments: parsed.attachments.map((att, index) => ({
      filename: att.filename || 'attachment',
      size: att.size || 0,
      index,
    })),
  };
}
