// The restaurant's own words for guests: placeholders filled, an empty one tidied away, the default when unwritten.
import { fillMessage, ownMessage } from '../utils/guestMessages';

describe('guest messages', () => {
  it('fills the placeholders', () => {
    expect(fillMessage('Thanks, {name}! Order #{order} for table {table} at {restaurant}.', { name: 'Rahim', order: 12, table: '4', restaurant: 'Sholo Aana' })).toBe(
      'Thanks, Rahim! Order #12 for table 4 at Sholo Aana.'
    );
    expect(fillMessage('আমি {waiter}, {restaurant}-এ স্বাগতম!', { waiter: 'Mitu', restaurant: 'ষোলআনা' })).toBe('আমি Mitu, ষোলআনা-এ স্বাগতম!');
  });

  it('a placeholder with no value goes, with the comma it leaves', () => {
    expect(fillMessage('Thank you, {name}!', {})).toBe('Thank you!');
    expect(fillMessage('ধন্যবাদ, {name}।', { name: '' })).toBe('ধন্যবাদ।');
  });

  it('the restaurant’s text in the guest’s language, else null (the default is used)', () => {
    const m = { pickupTitle: { en: 'Ready soon, {name}!', bn: '' } };
    expect(ownMessage(m, 'pickupTitle', 'en', { name: 'Rahim' })).toBe('Ready soon, Rahim!');
    expect(ownMessage(m, 'pickupTitle', 'bn', { name: 'Rahim' })).toBeNull();
    expect(ownMessage(m, 'waiterCall', 'en', {})).toBeNull();
    expect(ownMessage(null, 'welcome', 'en', {})).toBeNull();
  });
});
