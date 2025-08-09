import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function CreateRestaurant() {
  const [name, setName] = useState('');
  const [restaurantUrl, setRestaurantUrl] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // TODO: Call your backend API to create restaurant
    // await api.createRestaurant({ name, restaurantUrl });
    navigate(`/${restaurantUrl}/welcome`);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto mt-20 p-8 bg-white rounded shadow">
      <h2 className="text-2xl font-bold mb-6">Create Restaurant</h2>
      <input
        className="border p-2 w-full mb-4"
        placeholder="Restaurant Name"
        value={name}
        onChange={e => setName(e.target.value)}
        required
      />
      <input
        className="border p-2 w-full mb-4"
        placeholder="Restaurant URL"
        value={restaurantUrl}
        onChange={e => setRestaurantUrl(e.target.value)}
        required
      />
      <button type="submit" className="w-full bg-blue-500 text-white p-2 rounded">Create Restaurant</button>
    </form>
  );
}