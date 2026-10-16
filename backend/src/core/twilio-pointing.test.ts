import { decidePointing, isTunnelHost } from './twilio-pointing';

const PRODUCTION = 'https://dailyleadhub.com/api/webhooks/twilio/incoming';
const LAPTOP = 'https://quiet-river-maple.trycloudflare.com/api/webhooks/twilio/incoming';
const OLD_TUNNEL = 'https://loud-ocean-birch.trycloudflare.com/api/webhooks/twilio/incoming';

describe('pointing a number or app at this server', () => {
  describe('from a laptop', () => {
    it('refuses to move production - the mistake this exists to stop', () => {
      expect(decidePointing({ voiceUrl: PRODUCTION, voiceMethod: 'POST' }, LAPTOP, false)).toEqual({
        action: 'refuse',
        why: 'other_server',
        current: PRODUCTION,
      });
    });

    it('moves it only when told to, with --take-over', () => {
      expect(decidePointing({ voiceUrl: PRODUCTION, voiceMethod: 'POST' }, LAPTOP, true)).toEqual({ action: 'point' });
    });

    it('points a number that points nowhere - a new dev number', () => {
      expect(decidePointing({ voiceUrl: null }, LAPTOP, false)).toEqual({ action: 'point' });
      expect(decidePointing({ voiceUrl: '' }, LAPTOP, false)).toEqual({ action: 'point' });
    });

    it('points one left on an earlier tunnel - the address changes every session', () => {
      expect(decidePointing({ voiceUrl: OLD_TUNNEL, voiceMethod: 'POST' }, LAPTOP, false)).toEqual({ action: 'point' });
    });
  });

  describe('on the server', () => {
    it('brings production back from a tunnel without --take-over - the recovery after an accident', () => {
      expect(decidePointing({ voiceUrl: LAPTOP, voiceMethod: 'POST' }, PRODUCTION, false)).toEqual({ action: 'point' });
    });

    it('changes nothing when it already points here', () => {
      expect(decidePointing({ voiceUrl: PRODUCTION, voiceMethod: 'POST' }, PRODUCTION, false)).toEqual({
        action: 'unchanged',
      });
    });

    it('fixes the method on its own server', () => {
      expect(decidePointing({ voiceUrl: PRODUCTION, voiceMethod: 'GET' }, PRODUCTION, false)).toEqual({ action: 'point' });
    });

    it('refuses a number that points at this app on a different real server', () => {
      const elsewhere = 'https://old-domain.example.com/api/webhooks/twilio/incoming';
      expect(decidePointing({ voiceUrl: elsewhere }, PRODUCTION, false)).toEqual({
        action: 'refuse',
        why: 'other_server',
        current: elsewhere,
      });
    });
  });

  describe('somebody else\'s line', () => {
    it('refuses an address that is not this app, on any host', () => {
      for (const voiceUrl of [
        'https://demo.twilio.com/welcome/voice/',
        'https://dailyleadhub.com/something-else',
        'https://quiet-river-maple.trycloudflare.com/other/path',
      ]) {
        expect(decidePointing({ voiceUrl }, PRODUCTION, false)).toEqual({ action: 'refuse', why: 'elsewhere', current: voiceUrl });
      }
    });

    it('refuses an address that is not a URL at all', () => {
      expect(decidePointing({ voiceUrl: 'not a url' }, PRODUCTION, false)).toEqual({
        action: 'refuse',
        why: 'elsewhere',
        current: 'not a url',
      });
    });

    it('refuses a number answered by another TwiML App, which wins over its Voice URL', () => {
      expect(decidePointing({ voiceUrl: PRODUCTION, applicationSid: 'AP123' }, PRODUCTION, false)).toEqual({
        action: 'refuse',
        why: 'other_app',
        current: 'TwiML App AP123',
      });
    });

    it('takes any of them with --take-over', () => {
      expect(decidePointing({ voiceUrl: 'https://demo.twilio.com/x' }, PRODUCTION, true)).toEqual({ action: 'point' });
      expect(decidePointing({ voiceUrl: null, applicationSid: 'AP123' }, PRODUCTION, true)).toEqual({ action: 'point' });
    });
  });
});

describe('isTunnelHost', () => {
  it.each(['quiet-river-maple.trycloudflare.com', 'abc123.ngrok-free.app', 'abc.ngrok.io', 'abc.ngrok.app', 'abc.ngrok-free.dev'])(
    '%s is a tunnel',
    (host) => expect(isTunnelHost(host)).toBe(true)
  );

  it.each(['dailyleadhub.com', 'trycloudflare.com.evil.example', 'ngrok.io.example.com', 'example.com'])(
    '%s is not',
    (host) => expect(isTunnelHost(host)).toBe(false)
  );
});
