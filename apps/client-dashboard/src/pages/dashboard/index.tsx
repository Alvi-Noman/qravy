import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useState } from 'react';
import api, { fetchDashboardMenu } from '../../api/auth';
import { useRequireOnboardedUser } from '../../hooks/useRequireOnboardedUser';

type MenuItem = {
  _id: string;
  name: string;
  price: number;
  restaurant: string;
};

type AddProductForm = {
  name: string;
  price: number;
};

export default function Dashboard() {
  useRequireOnboardedUser();
  const [showModal, setShowModal] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<MenuItem[]>({
    queryKey: ['dashboard-menu'],
    queryFn: fetchDashboardMenu,
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<AddProductForm>();

  const addProductMutation = useMutation({
    mutationFn: async (form: AddProductForm) => {
      const res = await api.post('/api/v1/dashboard/menu', {
        ...form,
        price: Number(form.price),
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-menu'] }); // FIXED: use string, not array
      setShowModal(false);
      reset();
    },
  });

  const onSubmit = (form: AddProductForm) => {
    addProductMutation.mutate({ ...form, price: Number(form.price) });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-[#ececec] px-6 py-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-[#2e2e30]">Your Restaurant Menu</h2>
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded font-medium hover:bg-blue-700 transition"
          onClick={() => setShowModal(true)}
        >
          + Add Product
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading && (
          <div className="text-lg text-gray-500">Loading your menu...</div>
        )}
        {error && (
          <div className="text-red-500">Error loading menu. Please try again.</div>
        )}
        {!isLoading && !error && (!data || data.length === 0) && (
          <div className="text-gray-500">No menu items found for your restaurant.</div>
        )}
        {!isLoading && !error && data && data.length > 0 && (
          <ul className="space-y-4">
            {data.map((item) => (
              <li key={item._id} className="flex items-center justify-between border-b pb-2">
                <span className="font-medium text-[#2e2e30]">{item.name}</span>
                <span className="ml-4 text-gray-600">${item.price}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Modal for Add Product */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg p-8 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4">Add Product</h3>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="block mb-1 font-medium">Product Name</label>
                <input
                  className="border p-2 w-full rounded"
                  {...register('name', { required: 'Name is required' })}
                />
                {errors.name && <div className="text-red-500 text-sm">{errors.name.message}</div>}
              </div>
              <div>
                <label className="block mb-1 font-medium">Price</label>
                <input
                  type="number"
                  step="0.01"
                  className="border p-2 w-full rounded"
                  {...register('price', {
                    required: 'Price is required',
                    min: { value: 0, message: 'Price must be positive' },
                  })}
                />
                {errors.price && <div className="text-red-500 text-sm">{errors.price.message}</div>}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="px-4 py-2 rounded bg-gray-200 text-gray-700"
                  onClick={() => {
                    setShowModal(false);
                    reset();
                  }}
                  disabled={addProductMutation.isPending} // FIXED: use isPending
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-blue-600 text-white font-medium"
                  disabled={addProductMutation.isPending} // FIXED: use isPending
                >
                  {addProductMutation.isPending ? 'Adding...' : 'Add'}
                </button>
              </div>
              {addProductMutation.isError && (
                <div className="text-red-500 text-sm mt-2">
                  Error adding product. Please try again.
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}